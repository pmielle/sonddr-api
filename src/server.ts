import express, { NextFunction, Request, Response } from "express";
import { NotFoundError, Filter } from "./types.js";
import { deleteDocument, getDocument, getDocuments, patchDocument, postDocument, putDocument } from "./database.js";
import chalk from "chalk";
import { Cheer, DbComment, Comment, DbDiscussion, DbIdea, Goal, Idea, Notification, Vote, makeCheerId, makeVoteId, ping_str, delete_str, DbUser, Change, Discussion, User } from "sonddr-shared";
import session from "express-session";
import { SSE } from "./sse.js";
import { reviveDiscussion, reviveDiscussions, reviveUser, reviveUsers } from "./revivers.js";
import { discussionsChanges$, notificationsChanges$ } from "./triggers.js";
import { filter as rxFilter } from "rxjs";
import { ChatRoom, ChatRoomManager } from "./chat-room.js";
import { createServer, IncomingMessage } from "http";
import { WebSocketServer } from "ws";
import { multerPath, upload } from "./uploads.js";
import { Auth } from "./auth.js";
import { deleteIdea, getIdea, getIdeas, patchIdea, postIdea } from "./handlers/ideas.js";

const port = 3000;
const app = express();
const server = createServer(app);
const messagesWss = new WebSocketServer({ noServer: true });

app.use(express.json());  // otherwise req.body is undefined


// store
// --------------------------------------------
const memoryStore = new session.MemoryStore();
app.use(session({
	secret: 'some secret',
	saveUninitialized: true,
	resave: false,
	store: memoryStore,
}));


// authentication
// ----------------------------------------------
const auth = new Auth(memoryStore);
app.use(auth.keycloak.middleware());


// routes
// ----------------------------------------------
const router = express.Router();

router.use("/uploads", express.static(multerPath));

router.get('/ideas', auth.keycloak.protect(), auth.fetchUserId, async (req, res, next) => {
	try {
		await getIdeas(req, res, next);
	} catch (err) {
		next(err);
	}
});

router.get('/ideas/:id', auth.keycloak.protect(), auth.fetchUserId, async (req, res, next) => {
	try {
		await getIdea(req, res, next);
	} catch (err) {
		next(err);
	}
});

router.delete('/ideas/:id',
	auth.keycloak.protect(),
	auth.fetchUserId,
	async (req, res, next) => {
		try {
			await deleteIdea(req, res, next);
		} catch (err) {
			next(err);
		}
	});

router.patch(`/ideas/:id`,
	auth.keycloak.protect(),
	auth.fetchUserId,
	upload.fields([{ name: "cover", maxCount: 1 }, { name: "images" }]),
	async (req, res, next) => {
		try {
			await patchIdea(req, res, next);
		} catch (err) {
			next(err);
		}
	});

router.post('/ideas',
	auth.keycloak.protect(),
	auth.fetchUserId,
	upload.fields([{ name: "cover", maxCount: 1 }, { name: "images" },]),
	async (req, res, next) => {
		try {
			await postIdea(req, res, next);
		} catch (err) {
			next(err);
		}
	});

router.patch(`/users/:id`, auth.keycloak.protect(), auth.fetchUserId, async (req, res, next) => {
	try {
		// only the user is allowed to edits its external links
		const path = _getReqPath(req);
		const userId = req.params["id"];
		if (!userId === req["userId"]) { throw new Error(`Unauthorized`); }
		// find links to remove or to add
		const linkToRemove = req.body["removeExternalLink"];
		const linkToAdd = req.body["addExternalLink"];
		if (!linkToRemove && !linkToAdd) { throw new Error(`Both remove- and addExternalLink are missing`); }
		const promises: Promise<void>[] = [];
		if (linkToRemove) {
			promises.push(patchDocument(path, {
				field: 'externalLinks',
				operator: 'pull',
				value: { type: linkToRemove.type },
			}))
		}
		if (linkToAdd) {
			promises.push(patchDocument(path, {
				field: 'externalLinks',
				operator: 'addToSet',
				value: linkToAdd,
			}))
		}
		await Promise.all(promises);
		res.send();
	} catch (err) {
		next(err);
	}
});

router.delete(`/votes/:id`, auth.keycloak.protect(), auth.fetchUserId, async (req, res, next) => {
	try {
		const doc = await getDocument<Vote>(_getReqPath(req));
		if (doc.authorId !== req["userId"]) {
			throw new Error(`${req["userId"]} is not the author of the vote`);
		}
		// get previous value and patch the rating of the comment
		const previousValue = await getDocument<Vote>(_getReqPath(req))
			.then(v => v.value)
			.catch(err => {
				if (!(err instanceof NotFoundError)) { throw err; }
				return 0;
			});
		await patchDocument(`comments/${doc.commentId}`, { field: "rating", operator: "inc", value: -1 * previousValue });
		// delete the vote
		await deleteDocument(_getReqPath(req));
		res.send();
	} catch (err) {
		next(err);
	}
});

router.put(`/votes/:id`, auth.keycloak.protect(), auth.fetchUserId, async (req, res, next) => {
	try {
		const value = _getFromReqBody<number>("value", req);
		if (![1, -1].includes(value)) { throw new Error(`Value must be 1 or -1`); }
		const commentId = _getFromReqBody<string>("commentId", req);
		const userId = req["userId"];
		const voteId = makeVoteId(commentId, userId);
		// get previous vote value to determine the new comment rating
		const previousValue = await getDocument<Vote>(_getReqPath(req))
			.then(v => v.value)
			.catch(err => {
				if (!(err instanceof NotFoundError)) { throw err; }
				return 0;
			});
		const valueDiff = value - previousValue;
		if (valueDiff !== 0) {
			await patchDocument(
				`comments/${commentId}`,
				{ field: "rating", operator: "inc", value: valueDiff },
			);
		}
		// put the vote, allow upsert
		await putDocument(_getReqPath(req), {
			id: voteId,
			authorId: userId,
			commentId: commentId,
			value: value,
		}, true);
		res.send();
	} catch (err) {
		next(err);
	}
});

router.delete(`/cheers/:id`, auth.keycloak.protect(), auth.fetchUserId, async (req, res, next) => {
	try {
		const doc = await getDocument<Cheer>(_getReqPath(req));
		if (doc.authorId !== req["userId"]) {
			throw new Error(`${req["userId"]} is not the author of the cheer`);
		}
		await patchDocument(`ideas/${doc.ideaId}`, { field: "supports", operator: "inc", value: -1 });
		await deleteDocument(_getReqPath(req));
		res.send();
	} catch (err) {
		next(err);
	}
});

router.get('/cheers/:id', auth.keycloak.protect(), async (req, res, next) => {
	try {
		const doc = await getDocument<Cheer>(_getReqPath(req));
		res.json(doc);
	} catch (err) {
		next(err);
	}
});

router.put('/cheers/:id', auth.keycloak.protect(), auth.fetchUserId, async (req, res, next) => {
	try {
		const ideaId = _getFromReqBody("ideaId", req);
		const userId = req["userId"];
		const id = makeCheerId(ideaId as string, userId);
		const payload = {
			id: id,
			ideaId: ideaId,
			authorId: userId,
		};
		await putDocument(_getReqPath(req), payload);
		await patchDocument(`ideas/${ideaId}`, { field: "supports", operator: "inc", value: 1 });
		res.send();
	} catch (err) {
		next(err);
	}
});

router.get('/comments/:id', auth.keycloak.protect(), auth.fetchUserId, async (req, res, next) => {
	try {
		const dbDoc = await getDocument<DbComment>(_getReqPath(req));
		const user = await getDocument<DbUser>(`users/${dbDoc.authorId}`).then(dbDoc => reviveUser(dbDoc, req["userId"]));
		const { authorId, ...doc } = dbDoc;
		doc["author"] = user;

		try {
			const voteId = makeVoteId(dbDoc.id, req["userId"]);
			const vote = await getDocument<Vote>(`votes/${voteId}`);
			doc["userVote"] = vote.value;
		} catch (err) { if (!(err instanceof NotFoundError)) { throw err; } }

		res.json(doc);
	} catch (err) {
		next(err);
	}
});

router.post('/comments', auth.keycloak.protect(), auth.fetchUserId, async (req, res, next) => {
	try {
		const payload = {
			ideaId: _getFromReqBody("ideaId", req),
			content: _getFromReqBody("content", req),
			authorId: req["userId"],
			date: new Date(),
			rating: 0,
		};
		const insertedId = await postDocument(_getReqPath(req), payload);
		res.json({ insertedId: insertedId });
	} catch (err) {
		next(err);
	}
});

router.post('/discussions', auth.keycloak.protect(), auth.fetchUserId, async (req, res, next) => {
	try {
		const fromUserId = req["userId"];
		const toUserId = _getFromReqBody("toUserId", req);
		const firstMessageContent = _getFromReqBody("firstMessageContent", req);
		const discussionPayload = {
			userIds: [fromUserId, toUserId],
			readByIds: [],
		};
		const discussionId = await postDocument(_getReqPath(req), discussionPayload);
		const firstMessagePayload = {
			discussionId: discussionId,
			authorId: fromUserId,
			content: firstMessageContent,
			date: new Date(),
			deleted: false,
		};
		const firstMessageId = await postDocument('messages', firstMessagePayload);
		await patchDocument(
			`discussions/${discussionId}`,
			[
				{ field: "lastMessageId", operator: "set", value: firstMessageId },
				{ field: "readByIds", operator: "set", value: [fromUserId] },
				{ field: "date", operator: "set", value: firstMessagePayload.date },
			]
		);
		res.json({ insertedId: discussionId });
	} catch (err) {
		next(err);
	};
});

router.get('/users', auth.keycloak.protect(), auth.fetchUserId, async (req, res, next) => {
	try {
		const regex = req.query.regex;
		const filters: Filter[] = [];
		if (regex) {
			filters.push({ field: "name", operator: "regex", value: regex });
		}
		const users = await getDocuments<DbUser>(
			_getReqPath(req),
			{ field: 'name', desc: false },
			filters
		).then(dbDocs => reviveUsers(dbDocs, req["userId"]));
		res.json(users);
	} catch (err) {
		next(err);
	}
});

router.delete('/comments/:id', auth.keycloak.protect(), auth.fetchUserId, async (req, res, next) => {
	try {
		const comment = await getDocument<DbComment>(_getReqPath(req));
		if (comment.authorId !== req["userId"]) { throw new Error("Unauthorized"); }
		await deleteDocument(_getReqPath(req));
		res.send();
	} catch (err) {
		next(err);
	}
});

router.put('/users/:id', auth.keycloak.protect(), auth.fetchUserId, async (req, res, next) => {
	try {
		const payload = {
			id: req["userId"],
			name: _getFromReqBody("name", req),
			date: new Date(),
			externalLinks: [],
			bio: "",
		};
		await putDocument(_getReqPath(req), payload);
		res.send();
	} catch (err) {
		next(err);
	};
});

router.get('/goals', auth.keycloak.protect(), async (req, res, next) => {
	try {
		const docs = await getDocuments<Goal>(_getReqPath(req), { field: "order", desc: false });
		res.json(docs);
	} catch (err) {
		next(err);
	}
});

router.get('/goals/:id', auth.keycloak.protect(), async (req, res, next) => {
	try {
		const doc = await getDocument<Goal>(_getReqPath(req));
		res.json(doc);
	} catch (err) {
		next(err);
	}
});

router.get('/users/:id', auth.keycloak.protect(), auth.fetchUserId, async (req, res, next) => {
	try {
		const doc = await getDocument<DbUser>(_getReqPath(req)).then(dbDoc => reviveUser(dbDoc, req["userId"]));
		res.json(doc);
	} catch (err) {
		next(err);
	}
});

router.get('/comments', auth.keycloak.protect(), auth.fetchUserId, async (req, res, next) => {
	try {
		const order = req.query.order || "date";
		const ideaId = req.query.ideaId;
		const authorId = req.query.authorId;
		const filters: Filter[] = [];
		if (ideaId) {
			filters.push({ field: "ideaId", operator: "eq", value: ideaId });
		}
		if (authorId) {
			filters.push({ field: "authorId", operator: "eq", value: authorId });
		}
		const dbDocs = await getDocuments<DbComment>(
			_getReqPath(req),
			{ field: order as string, desc: true },
			filters
		);
		if (dbDocs.length == 0) {
			res.json([]);
			return;
		}
		const authorsToGet = _getUnique(dbDocs, "authorId");
		const votesToGet = _getUnique(dbDocs, "id");
		const [authors, votes] = await Promise.all([
			getDocuments<DbUser>("users", undefined, { field: "id", operator: "in", value: authorsToGet })
				.then(dbDocs => reviveUsers(dbDocs, req["userId"])),
			getDocuments<Vote>("votes", undefined, [
				{ field: "commentId", operator: "in", value: votesToGet },
				{ field: "authorId", operator: "eq", value: req["userId"] },
			]),
		]);

		const docs: Comment[] = dbDocs.map((dbDoc) => {
			const { authorId, ...data } = dbDoc;
			data["author"] = authors.find(u => u.id === authorId);
			const vote = votes.find(v => v.commentId === dbDoc.id);  // might be undefined
			data["userVote"] = vote ? vote.value : undefined;
			return data as any;
		});
		res.json(docs);
	} catch (err) {
		next(err);
	}
});

router.patch('/discussions/:id', auth.keycloak.protect(), auth.fetchUserId, async (req, res, next) => {
	try {
		await patchDocument(_getReqPath(req), { field: 'readByIds', operator: 'addToSet', value: req["userId"] });
		res.send();
	} catch (err) {
		next(err);
	}
});

router.patch('/notifications/:id', auth.keycloak.protect(), auth.fetchUserId, async (req, res, next) => {
	try {
		await patchDocument(_getReqPath(req), { field: 'readByIds', operator: 'addToSet', value: req["userId"] });
		res.send();
	} catch (err) {
		next(err);
	}
});

router.get('/discussions/:id', auth.keycloak.protect(), async (req, res, next) => {
	try {
		const doc = await getDocument<DbDiscussion>(_getReqPath(req))
			.then(dbDoc => reviveDiscussion(dbDoc));
		res.json(doc);
	} catch (err) {
		next(err);
	}
});

router.get('/discussions', async (req, res, next) => {
	try {

		await auth.authenticateRequest(req);
		const userId = req["userId"];

		const filter: Filter = { field: "userIds", operator: "in", value: [userId] };

		const sse = new SSE(res);

		const docs = await getDocuments<DbDiscussion>(
			_getReqPath(req),
			{ field: "date", desc: true },
			{ ...filter },  // otherwise can't be reused in watch()
		).then(dbDocs => reviveDiscussions(dbDocs));

		sse.send(docs);

		const changesSub = discussionsChanges$.pipe(
			rxFilter(change => _getUsersOfDiscussionChange(change).map(u => u.id).includes(userId)),
		).subscribe(change => sse.send(change));

		// heartbeat to keep the connection alive
		// otherwise nginx timeouts after 60s
		const pingId = setInterval(() => sse.send(ping_str), 30000);

		req.on("close", () => {
			clearInterval(pingId);
			changesSub.unsubscribe()
		});

	} catch (err) {
		next(err);
	}
});

router.get('/notifications', async (req, res, next) => {
	try {

		await auth.authenticateRequest(req);
		const userId = req["userId"];

		const sse = new SSE(res);

		const docs = await getDocuments<Notification>(
			_getReqPath(req),
			{ field: "date", desc: true },
			{ field: "toIds", operator: "in", value: [userId] },
		);

		sse.send(docs);

		const changesSub = notificationsChanges$.pipe(
			rxFilter(change => _getToIdsOfNotificationChange(change).includes(userId)),
		).subscribe(change => sse.send(change));

		// heartbeat to keep the connection alive
		// otherwise nginx timeouts after 60s
		const pingId = setInterval(() => sse.send(ping_str), 30000);

		req.on("close", () => {
			clearInterval(pingId);
			changesSub.unsubscribe()
		});

	} catch (err) {
		next(err);
	}
});

app.use(basePath, router);


// websockets
// ----------------------------------------------
server.on("upgrade", async (incomingMessage, duplex, buffer) => {
	duplex.on("error", (err) => console.error(err));

	try {

		await auth.authenticateIncomingMessage(incomingMessage);

		if (incomingMessage.url!.startsWith(`${wsBasePath}/messages`)) {
			messagesWss.handleUpgrade(incomingMessage, duplex, buffer, (ws) => {
				messagesWss.emit('connection', ws, incomingMessage);
			});
		} else {
			throw new Error(`Unexpected websocket url: ${incomingMessage.url}`);
		}

	} catch (err) {
		duplex.destroy(err);
	}
});

const roomManager = new ChatRoomManager();

messagesWss.on('connection', (ws, incomingMessage) => {

	const userId = incomingMessage["userId"];
	const discussionId = _getFromIncomingMessageQuery<string>("discussionId", incomingMessage);

	const room: ChatRoom = roomManager.getOrCreateRoom(discussionId, userId, ws);
	// n.b. no need to send previous messages, ChatRoom does it

	ws.on("message", async (data) => {

		const message = data.toString();

		if (message.startsWith(delete_str)) {

			const messageId = message.substring(delete_str.length);

			await patchDocument(
				`messages/${messageId}`,
				[
					{ field: "deleted", operator: "set", value: true },
					{ field: "content", operator: "set", value: "Deleted" },
				]
			);

		} else {

			const newMessagePayload = {
				discussionId: discussionId,
				authorId: userId,
				date: new Date(),
				content: message,
				deleted: false,
			};
			const newMessageId = await postDocument('messages', newMessagePayload);
			patchDocument(
				`discussions/${discussionId}`,
				[
					{ field: "lastMessageId", operator: "set", value: newMessageId },
					{ field: "readByIds", operator: "set", value: [userId] },
					{ field: "date", operator: "set", value: newMessagePayload.date },
				]
			);

		}
		// n.b. no need to dispatch anything, ChatRoom reacts to database changes

	});

	// heartbeat to keep the connection alive
	// otherwise nginx timeouts after 60s
	const pingId = setInterval(() => ws.ping(), 30000);

	ws.on("close", () => {
		clearInterval(pingId);  // stop ping loop
		room.leave(userId);
	});

});


// error handling
// ----------------------------------------------
app.use(_errorHandler);

server.listen(port, () => {
	console.log(`Listening on port ${port}`);
	console.log(`\n`);
});


// private
// ----------------------------------------------
function _getUsersOfDiscussionChange(change: Change<Discussion>): User[] {
	const users = change.docBefore?.users || change.docAfter?.users;
	if (!users) { throw new Error("Failed to find users of change"); }
	return users;
}

function _getToIdsOfNotificationChange(change: Change<Notification>): string[] {
	const toIds = change.docBefore?.toIds || change.docAfter?.toIds;
	if (!toIds) { throw new Error("Failed to find toIds of change"); }
	return toIds;
}

function _getFromReqQuery<T>(key: string, req: Request): T {
	const value = req.query[key];
	if (value === undefined) { throw new Error(`${key} not found in request query parameters`); }
	return value as T;
}

function _getFromIncomingMessageQuery<T>(key: string, incomingMessage: IncomingMessage): T {
	const url = new URL(incomingMessage.url, `http://${incomingMessage.headers.host}`);
	const value = url.searchParams.get(key);
	if (!value) { throw new Error(`${key} not found in request query parameters`); }
	return value as T;
}

function _errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
	console.error(chalk.red(`⚠️ ⚠️ ⚠️ ERROR AT ${new Date()}`));
	console.error(`------------------------------`);
	console.error(`REQUEST DETAILS`);
	console.error(`------------------------------`);
	console.error(`method : ${req.method}`);
	console.error(`url    : ${req.originalUrl}`);
	console.error(`body   : ${JSON.stringify(req.body)}`);
	console.error(chalk.gray(`headers: ${JSON.stringify(req.headers)}`));
	console.error(`------------------------------`);
	console.error(`ERROR MESSAGE`);
	console.error(`------------------------------`);
	console.error(err);
	console.error(`\n\n`);
	if (err instanceof NotFoundError) {
		res.status(404).send();
	} else {
		res.status(500).send();
	}
}
