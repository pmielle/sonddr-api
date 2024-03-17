import express, { NextFunction, Request, Response } from "express";
import session from "express-session";
import chalk from "chalk";
import { createServer, IncomingMessage } from "http";
import { WebSocketServer } from "ws";
import { delete_str, } from "sonddr-shared";
import { NotFoundError, } from "./types.js";
import { basePath, wsBasePath } from "./routes.js";
import { patchDocument, postDocument, } from "./database.js";
import { ChatRoom, ChatRoomManager } from "./chat-room.js";
import { multerPath, upload } from "./uploads.js";
import { _getReqPath } from "./handlers.js";
import { deleteIdea, getIdea, getIdeas, patchIdea, postIdea } from "./handlers/ideas.js";
import { getGoal, getGoals } from "./handlers/goals.js";
import { getUser, getUsers, patchUser, putUser } from "./handlers/users.js";
import { deleteVote, putVote } from "./handlers/votes.js";
import { deleteCheer, getCheer, putCheer } from "./handlers/cheers.js";
import { deleteComment, getComment, getComments, postComment } from "./handlers/comments.js";
import { getDiscussion, getDiscussions, patchDiscussion, postDiscussion } from "./handlers/discussions.js";
import { getNotifications, patchNotification } from "./handlers/notifications.js";
import { startAllTriggers } from "./triggers.js";
import { init_keycloak, fetchUserId, keycloak } from "./auth.js";
import { authenticateIncomingMessage, authenticateRequest } from "./auth.js";

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
init_keycloak(memoryStore);
app.use(keycloak.middleware());


// routes
// ----------------------------------------------
const router = express.Router();

router.use("/uploads", express.static(multerPath));

// goals
router.get('/goals',
	keycloak.protect(),
	async (req, res, next) => {
		try {
			await getGoals(req, res, next);
		} catch (err) {
			next(err);
		}
	});

router.get('/goals/:id',
	keycloak.protect(),
	async (req, res, next) => {
		try {
			await getGoal(req, res, next);
		} catch (err) {
			next(err);
		}
	});

router.get('/ideas',
	keycloak.protect(),
	fetchUserId,
	async (req, res, next) => {
		try {
			await getIdeas(req, res, next);
		} catch (err) {
			next(err);
		}
	});

// ideas
router.get('/ideas/:id',
	keycloak.protect(),
	fetchUserId, async (req, res, next) => {
		try {
			await getIdea(req, res, next);
		} catch (err) {
			next(err);
		}
	});

router.delete('/ideas/:id',
	keycloak.protect(),
	fetchUserId,
	async (req, res, next) => {
		try {
			await deleteIdea(req, res, next);
		} catch (err) {
			next(err);
		}
	});

router.patch(`/ideas/:id`,
	keycloak.protect(),
	fetchUserId,
	upload.fields([{ name: "cover", maxCount: 1 }, { name: "images" }]),
	async (req, res, next) => {
		try {
			await patchIdea(req, res, next);
		} catch (err) {
			next(err);
		}
	});

router.post('/ideas',
	keycloak.protect(),
	fetchUserId,
	upload.fields([{ name: "cover", maxCount: 1 }, { name: "images" },]),
	async (req, res, next) => {
		try {
			await postIdea(req, res, next);
		} catch (err) {
			next(err);
		}
	});

// users
router.patch(`/users/:id`,
	keycloak.protect(),
	fetchUserId,
	async (req, res, next) => {
		try {
			await patchUser(req, res, next);
		} catch (err) {
			next(err);
		}
	});

router.get('/users',
	keycloak.protect(),
	fetchUserId,
	async (req, res, next) => {
		try {
			await getUsers(req, res, next);
		} catch (err) {
			next(err);
		}
	});

router.put('/users/:id',
	keycloak.protect(),
	fetchUserId,
	async (req, res, next) => {
		try {
			await putUser(req, res, next);
		} catch (err) {
			next(err);
		};
	});

router.get('/users/:id',
	keycloak.protect(),
	fetchUserId,
	async (req, res, next) => {
		try {
			await getUser(req, res, next);
		} catch (err) {
			next(err);
		}
	});

// votes
router.delete(`/votes/:id`,
	keycloak.protect(),
	fetchUserId,
	async (req, res, next) => {
		try {
			await deleteVote(req, res, next);
		} catch (err) {
			next(err);
		}
	});

router.put(`/votes/:id`,
	keycloak.protect(),
	fetchUserId,
	async (req, res, next) => {
		try {
			await putVote(req, res, next);
		} catch (err) {
			next(err);
		}
	});

// cheers
router.delete(`/cheers/:id`,
	keycloak.protect(),
	fetchUserId,
	async (req, res, next) => {
		try {
			await deleteCheer(req, res, next);
		} catch (err) {
			next(err);
		}
	});

router.get('/cheers/:id',
	keycloak.protect(),
	async (req, res, next) => {
		try {
			await getCheer(req, res, next);
		} catch (err) {
			next(err);
		}
	});

router.put('/cheers/:id',
	keycloak.protect(),
	fetchUserId,
	async (req, res, next) => {
		try {
			await putCheer(req, res, next);
		} catch (err) {
			next(err);
		}
	});

// comments
router.get('/comments/:id',
	keycloak.protect(),
	fetchUserId,
	async (req, res, next) => {
		try {
			await getComment(req, res, next);
		} catch (err) {
			next(err);
		}
	});

router.post('/comments',
	keycloak.protect(),
	fetchUserId,
	async (req, res, next) => {
		try {
			await postComment(req, res, next);
		} catch (err) {
			next(err);
		}
	});

router.delete('/comments/:id',
	keycloak.protect(),
	fetchUserId,
	async (req, res, next) => {
		try {
			await deleteComment(req, res, next);
		} catch (err) {
			next(err);
		}
	});

router.get('/comments',
	keycloak.protect(),
	fetchUserId,
	async (req, res, next) => {
		try {
			await getComments(req, res, next);
		} catch (err) {
			next(err);
		}
	});

// discussions
router.post('/discussions',
	keycloak.protect(),
	fetchUserId,
	async (req, res, next) => {
		try {
			await postDiscussion(req, res, next);
		} catch (err) {
			next(err);
		};
	});

router.patch('/discussions/:id',
	keycloak.protect(),
	fetchUserId,
	async (req, res, next) => {
		try {
			await patchDiscussion(req, res, next);
		} catch (err) {
			next(err);
		}
	});

router.get('/discussions/:id',
	keycloak.protect(),
	async (req, res, next) => {
		try {
			await getDiscussion(req, res, next);
		} catch (err) {
			next(err);
		}
	});

router.get('/discussions',
	authenticateRequest,
	async (req, res, next) => {
		try {
			await getDiscussions(req, res, next);
		} catch (err) {
			next(err);
		}
	});


// notifications
router.patch('/notifications/:id',
	keycloak.protect(),
	fetchUserId,
	async (req, res, next) => {
		try {
			await patchNotification(req, res, next);
		} catch (err) {
			next(err);
		}
	});

router.get('/notifications',
	authenticateRequest,
	async (req, res, next) => {
		try {
			await getNotifications(req, res, next);
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

		await authenticateIncomingMessage(incomingMessage);

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


// triggers
// ----------------------------------------------
startAllTriggers();


// error handling
// ----------------------------------------------
app.use(_errorHandler);

server.listen(port, () => {
	console.log(`Listening on port ${port}`);
	console.log(`\n`);
});


// private
// ----------------------------------------------
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
