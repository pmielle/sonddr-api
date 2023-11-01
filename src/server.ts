import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import { NotFoundError } from "./types";
import { Filter, deleteDocument, getDocument, getDocuments, makeMongoId, patchDocument, postDocument, putDocument } from "./database";
import chalk from "chalk";
import { Cheer, DbComment, Comment, DbDiscussion, DbIdea, DbMessage, DbNotification, Discussion, Goal, Idea, Message, Notification, User, Vote, makeCheerId, makeVoteId } from "sonddr-shared";
import session from "express-session";
import KeycloakConnect from "keycloak-connect";
import { SSE } from "./sse";

const port = 3000;
const app = express();
app.use(express.json());  // otherwise req.body is undefined
app.use(cors({origin: "http://0.0.0.0:4200"}));  // otherwise can't be reached by front

// authentication
// ----------------------------------------------
const memoryStore = new session.MemoryStore();
app.use(session({secret: 'some secret', saveUninitialized: true, resave: false, store: memoryStore}));
const keycloak = new KeycloakConnect({store: memoryStore});  // reads keycloak.json
app.use(keycloak.middleware());

async function fetchUserId(req: Request, res: Response, next: NextFunction) {
    const token = (await keycloak.getGrant(req, res)).access_token;
    const profile = await keycloak.grantManager.userInfo(token);
    req["userId"] = makeMongoId(profile["sub"]).toString();
    next();
}

// routes
// ----------------------------------------------
app.delete(`/votes/:id`, keycloak.protect(), fetchUserId, async (req, res, next) => {
    try {
        const doc = await getDocument<Vote>(_getReqPath(req));
        if (doc.authorId !== req["userId"]) {
            throw new Error(`${req["userId"]} is not the author of the vote`);
        }
        // get previous value and patch the rating of the comment
        const previousValue = await getDocument<Vote>(_getReqPath(req))
            .then(v => v.value)
            .catch(err => {
                if (! (err instanceof NotFoundError)) { throw err; }
                return 0;
            });
        await patchDocument(`comments/${doc.commentId}`, {field: "rating", operator: "inc", value: -1 * previousValue});
        // delete the vote
        await deleteDocument(_getReqPath(req));
        res.send();
    } catch(err) {
        next(err);
    }
});

app.put(`/votes/:id`, keycloak.protect(), fetchUserId, async (req, res, next) => {
    try {
        const value = _getFromReqBody<number>("value", req);
        if (! [1, -1].includes(value)) { throw new Error(`Value must be 1 or -1`); }
        const commentId = _getFromReqBody<string>("commentId", req);
        const userId = req["userId"];
        const voteId = makeVoteId(commentId, userId);
        // get previous vote value to determine the new comment rating
        const previousValue = await getDocument<Vote>(_getReqPath(req))
            .then(v => v.value)
            .catch(err => {
                if (! (err instanceof NotFoundError)) { throw err; }
                return 0;
            });
        const valueDiff = value - previousValue;
        if (valueDiff !== 0) {
            await patchDocument(
                `comments/${commentId}`, 
                {field: "rating", operator: "inc", value: valueDiff},
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
    } catch(err) {
        next(err);
    }
});

app.delete(`/cheers/:id`, keycloak.protect(), fetchUserId, async (req, res, next) => {
    try {
        const doc = await getDocument<Cheer>(_getReqPath(req));
        if (doc.authorId !== req["userId"]) {
            throw new Error(`${req["userId"]} is not the author of the cheer`);
        }
        await patchDocument(`ideas/${doc.ideaId}`, {field: "supports", operator: "inc", value: -1});
        await deleteDocument(_getReqPath(req));
        res.send();
    } catch(err) {
        next(err);
    }
});

app.get('/cheers/:id', keycloak.protect(), async (req, res, next) => {
    try {
        const doc = await getDocument<Cheer>(_getReqPath(req));
        res.json(doc);
    } catch(err) {
        next(err);
    }
});

app.put('/cheers/:id', keycloak.protect(), fetchUserId, async (req, res, next) => {
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
        await patchDocument(`ideas/${ideaId}`, {field: "supports", operator: "inc", value: 1});
        res.send();
    } catch(err) {
        next(err);
    }
});

app.get('/comments/:id', keycloak.protect(), fetchUserId, async (req, res, next) => {
    try {
        const dbDoc = await getDocument<DbComment>(_getReqPath(req));
        const user = await getDocument<User>(`users/${dbDoc.authorId}`);
        const {authorId, ...doc} = dbDoc;
        doc["author"] = user;

        // check if the user has voted
        try {
            const voteId = makeVoteId(dbDoc.id, req["userId"]);
            const vote = await getDocument<Vote>(`votes/${voteId}`);
            doc["userVote"] = vote.value;
        } catch(err) { if (! (err instanceof NotFoundError)) { throw err; } }

        res.json(doc);
    } catch(err) {
        next(err);
    }
});

app.post('/comments', keycloak.protect(), fetchUserId ,async (req, res, next) => {
    try {
        const payload = {
            ideaId: _getFromReqBody("ideaId", req),
            content: _getFromReqBody("content", req),
            authorId: req["userId"],
            date: new Date(),
            rating: 0,
        };
        const insertedId = await postDocument(_getReqPath(req), payload);
        res.json({insertedId: insertedId});
    } catch(err) {
        next(err);
    }
});

app.get('/messages/:id', keycloak.protect(), async (req, res, next) => {
    try {
        const dbDoc = await getDocument<DbMessage>(_getReqPath(req));
        const user = await getDocument<User>(`users/${dbDoc.authorId}`);
        const {authorId, ...doc} = dbDoc;
        doc["author"] = user;
        res.json(doc);
    } catch(err) {
        next(err);
    }
});

app.post('/messages', keycloak.protect(), fetchUserId ,async (req, res, next) => {
    try {
        const payload = {
            discussionId: _getFromReqBody("discussionId", req),
            content: _getFromReqBody("content", req),
            authorId: req["userId"],
            date: new Date(),
        };
        const discussion = await getDocument<DbDiscussion>(`discussions/${payload.discussionId}`);
        if (! discussion.userIds.includes(payload.authorId)) {
            throw new Error(`User ${payload.authorId} is not in discussion ${payload.discussionId}`);
        }
        const insertedId = await postDocument(_getReqPath(req), payload);
        await patchDocument(`discussions/${payload.discussionId}`, {field: "lastMessageId", operator: "set", value: insertedId});
        res.json({insertedId: insertedId});
    } catch(err) {
        next(err);
    }
});

app.post('/discussions', keycloak.protect(), fetchUserId, async (req, res, next) => {
    try {
        const fromUserId = req["userId"];
        const toUserId = _getFromReqBody("toUserId", req);
        const firstMessageContent = _getFromReqBody("firstMessageContent", req);
        const discussionPayload = {
            userIds: [fromUserId, toUserId],
        };
        const discussionId = await postDocument(_getReqPath(req), discussionPayload);
        const firstMessagePayload = {
            discussionId: discussionId,
            authorId: fromUserId,
            content: firstMessageContent,
            date: new Date(),
        };
        const firstMessageId = await postDocument('messages', firstMessagePayload);
        await patchDocument(`discussions/${discussionId}`, {field: "lastMessageId", operator: "set", value: firstMessageId});
        res.json({insertedId: discussionId});
    } catch(err) {
        next(err);
    };
});

app.get('/users', keycloak.protect(), async (req, res, next) => {
    try {
        const regex = req.query.regex;
        const filters: Filter[] = [];        
        if (regex) {
            filters.push({field: "name", operator: "regex", value: regex});
        }
        const users = await getDocuments<User>(
            _getReqPath(req), 
            {field: 'name', desc: false},
            filters
        );
        res.json(users);
    } catch(err) {
        next(err);
    }
});

app.post('/ideas', keycloak.protect(), fetchUserId, async (req, res, next) => {
    try {
        const payload = {
            title: _getFromReqBody("title", req),
            authorId: req["userId"],
            goalIds: _getFromReqBody("goalIds", req),
            content: _getFromReqBody("content", req),
            externalLinks: [],
            date: new Date(),
            supports: 0,
        };
        const insertedId = await postDocument(_getReqPath(req), payload);
        res.json({insertedId: insertedId});
    } catch(err) {
        next(err);
    }
});

app.put('/users/:id', keycloak.protect(), fetchUserId, async (req, res, next) => {
    try {
        const payload = {
            id: req["userId"],
            name: _getFromReqBody("name", req),
            date: new Date(),
            bio: null,
        };
        await putDocument(_getReqPath(req), payload);
        res.send();
    } catch(err) {
        next(err);
    };
});

app.get('/goals', keycloak.protect(), async (req, res, next) => {
    try {
        const docs = await getDocuments<Goal>(_getReqPath(req), {field: "order", desc: false});
        res.json(docs);
    } catch(err) { 
        next(err); 
    }
});

app.get('/goals/:id', keycloak.protect(), async (req, res, next) => {
    try {
        const doc = await getDocument<Goal>(_getReqPath(req));
        res.json(doc);
    } catch(err) { 
        next(err); 
    }
});

app.get('/users/:id', keycloak.protect(), async (req, res, next) => {
    try {
        const doc = await getDocument<User>(_getReqPath(req));
        res.json(doc);
    } catch(err) { 
        next(err); 
    }
});

app.get('/ideas/:id', keycloak.protect(), fetchUserId, async (req, res, next) => {
    try {
        const dbDoc = await getDocument<DbIdea>(_getReqPath(req));
        const cheerId = makeCheerId(dbDoc.id, req["userId"]);
        const [author, goals, userHasCheered] = await Promise.all([
            getDocument<User>(`users/${dbDoc.authorId}`),
            getDocuments<Goal>("goals", undefined, {field: "id", operator: "in", value: dbDoc.goalIds}),
            getDocument<Cheer>(`cheers/${cheerId}`)
                .then(() => true)
                .catch<boolean>(err => {
                    if (! (err instanceof NotFoundError)) { throw err; }
                    return false;
                }),
        ]);
        const {authorId, goalIds, ...data} = dbDoc;
        data["author"] = author;
        data["goals"] = goals;
        data["userHasCheered"] = userHasCheered;
        res.json(data);
    } catch(err) { 
        next(err); 
    }
});

app.get('/ideas', keycloak.protect(), fetchUserId, async (req, res, next) => {
    try {
        const order = req.query.order || "date";
        const goalId = req.query.goalId;
        const authorId = req.query.authorId;
        const regex = req.query.regex;
        const filters: Filter[] = [];    
        if (goalId) {
            filters.push({field: "goalIds", operator: "in", value: [goalId]});
        }    
        if (authorId) {
            filters.push({field: "authorId", operator: "eq", value: authorId});
        }
        if (regex) {
            filters.push({field: "title", operator: "regex", value: regex});
        }
        const dbDocs = await getDocuments<DbIdea>(
            _getReqPath(req), 
            {field: order as string, desc: true}, 
            filters
        );
        if (dbDocs.length == 0) { 
            res.json([]); 
            return; 
        }
        const authorsToGet = _getUnique(dbDocs, "authorId");
        const goalsToGet = _getUniqueInArray(dbDocs, "goalIds");
        const cheersToGet = _getUnique(dbDocs, "id");
        const [authors, goals, cheers] = await Promise.all([
            getDocuments<User>("users", undefined, {field: "id", operator: "in", value: authorsToGet}),
            getDocuments<Goal>("goals", undefined, {field: "id", operator: "in", value: goalsToGet}),
            getDocuments<Cheer>("cheers", undefined, [
                    {field: "ideaId", operator: "in", value: cheersToGet},
                    {field: "authorId", operator: "eq", value: req["userId"]},
                ]),
        ]);

        const docs: Idea[] = dbDocs.map((dbDoc) => {
            const {authorId, goalIds, ...data} = dbDoc;
            data["author"] = authors.find(u => u.id === authorId);
            data["goals"] = goals.filter(g => goalIds.includes(g.id));
            data["userHasCheered"] = cheers.find(c => c.ideaId === dbDoc.id) ? true : false;
            return data as any // typescript?? 
        });
        res.json(docs);
    } catch(err) { 
        next(err); 
    }
});

app.get('/comments', keycloak.protect(), fetchUserId, async (req, res, next) => {
    try {
        const order = req.query.order || "date";
        const ideaId = req.query.ideaId;
        const authorId = req.query.authorId;
        const filters: Filter[] = [];    
        if (ideaId) {
            filters.push({field: "ideaId", operator: "eq", value: ideaId});
        }    
        if (authorId) {
            filters.push({field: "authorId", operator: "eq", value: authorId});
        }
        const dbDocs = await getDocuments<DbComment>(
            _getReqPath(req), 
            {field: order as string, desc: true}, 
            filters
        );
        if (dbDocs.length == 0) { 
            res.json([]); 
            return; 
        }
        const authorsToGet = _getUnique(dbDocs, "authorId");
        const votesToGet = _getUnique(dbDocs, "id");
        const [authors, votes] = await Promise.all([
            getDocuments<User>("users", undefined, {field: "id", operator: "in", value: authorsToGet}),
            getDocuments<Vote>("votes", undefined, [
                {field: "commentId", operator: "in", value: votesToGet},
                {field: "authorId", operator: "eq", value: req["userId"]},
            ]),
        ]);
        
        const docs: Comment[] = dbDocs.map((dbDoc) => {
            const {authorId, ...data} = dbDoc;
            data["author"] = authors.find(u => u.id === authorId);
            const vote = votes.find(v => v.commentId === dbDoc.id);  // might be undefined
            data["userVote"] = vote ? vote.value : undefined;
            return data as any // typescript?? 
        });
        res.json(docs);
    } catch(err) { 
        next(err); 
    }
});

app.get('/messages', keycloak.protect(), async (req, res, next) => {
    try {
        const discussionId = req.query.discussionId;
        const authorId = req.query.authorId;
        const filters: Filter[] = [];    
        if (discussionId) {
            filters.push({field: "discussionId", operator: "eq", value: discussionId});
        }    
        if (authorId) {
            filters.push({field: "authorId", operator: "eq", value: authorId});
        }
        const dbDocs = await getDocuments<DbMessage>(
            _getReqPath(req), 
            {field: "date", desc: true},
            filters
        );
        if (dbDocs.length == 0) { 
            res.json([]); 
            return; 
        }
        const authorsToGet = _getUnique(dbDocs, "authorId");
        const authors = await getDocuments<User>("users", undefined, {field: "id", operator: "in", value: authorsToGet});
        const docs: Message[] = dbDocs.map((dbDoc) => {
            const {authorId, ...data} = dbDoc;
            data["author"] = authors.find(u => u.id === authorId);
            return data as any // typescript?? 
        });
        res.json(docs);
    } catch(err) { 
        next(err); 
    }
});

app.get('/discussions', async (req, res, next) => {  // TODO: secure it
    try {

        const sse = new SSE(res);

        const dbDocs = await getDocuments<DbDiscussion>(_getReqPath(req), {field: "date", desc: false});
        if (dbDocs.length == 0) { 
            res.json([]); 
            return; 
        }
        const messagesToGet = _getUnique(dbDocs, "lastMessageId");
        let usersToGet = _getUniqueInArray(dbDocs, "userIds");
        const messageDocs = await getDocuments<DbMessage>(
            "messages",
            undefined,
            {field: "id", operator: "in", value: messagesToGet}
        );
        const users = await getDocuments<User>(
            "users", 
            undefined, 
            {field: "id", operator: "in", value: usersToGet}
        );
        usersToGet.concat(_getUnique(messageDocs, "authorId"));
        const messages: Message[] = messageDocs.map((dbDoc) => {
            const {authorId, ...data} = dbDoc;
            data["author"] = users.find(u => u.id === authorId);
            return data as any;
        });
        const docs: Discussion[] = dbDocs.map((dbDoc) => {
            const {userIds, lastMessageId, ...data} = dbDoc;
            data["users"] = users.filter(u => userIds.includes(u.id));
            data["lastMessage"] = messages.find(m => m.id === lastMessageId);
            return data as any // typescript?? 
        });
        
        sse.send(docs);

    } catch(err) { 
        next(err); 
    }
});

app.get('/discussions/:id', keycloak.protect(), async (req, res, next) => {
    try {
        const dbDoc = await getDocument<DbDiscussion>(_getReqPath(req));
        const messageDoc = await getDocument<DbMessage>(`messages/${dbDoc.lastMessageId}`);
        const usersToGet = [
            ...dbDoc.userIds,
            messageDoc.authorId
        ];
        const users = await getDocuments<User>(
            "users", 
            undefined, 
            {field: "id", operator: "in", value: usersToGet}
        );
        const {authorId, ...message} = messageDoc;
        message["author"] = users.find(u => u.id === authorId);
        
        const {userIds, lastMessageId, ...doc} = dbDoc;
        doc["users"] = users.filter(u => userIds.includes(u.id));
        doc["lastMessage"] = message;
        res.json(doc);
    } catch(err) { 
        next(err); 
    }
});


app.get('/notifications', async (req, res, next) => {  // TODO: secure it
    try {

        const sse = new SSE(res);

        const dbDocs = await getDocuments<DbNotification>(_getReqPath(req), {field: "date", desc: false});
        if (dbDocs.length == 0) { 
            res.json([]); 
            return; 
        }
        let usersToGet = _getUnique(dbDocs, "fromId");
        const users = await getDocuments<User>(
            "users", 
            undefined, 
            {field: "id", operator: "in", value: usersToGet}
        );
        const docs: Notification[] = dbDocs.map((dbDoc) => {
            const {fromId, ...data} = dbDoc;
            data["from"] = users.find(u => fromId === u.id);
            data.content = data.content.replaceAll(/@@from.name@@/g, data["from"].name);
            return data as any // typescript?? 
        });
        
        sse.send(docs);

    } catch(err) { 
        next(err); 
    }
});


// error handling
// ----------------------------------------------
app.use(_errorHandler);

app.listen(port, '0.0.0.0', () => {
    console.log(`Listening on port ${port}`);
    console.log(`\n`);
});


// private
// ----------------------------------------------
function _getFromReqBody<T>(key: string, req: Request): T {
    const value = req.body[key];
    if (value === undefined) { throw new Error(`${key} not found in request body`); }
    return value;
}

function _getUnique<T, U extends keyof T>(collection: T[], key: U): T[U][] {
    return Array.from(collection.reduce((result, current) => {
        result.add(current[key] as T[U]);
        return result;
    }, new Set<T[U]>).values());
}

function _getUniqueInArray<T, U extends keyof T>(collection: T[], key: U): T[U] {
    return Array.from(collection.reduce((result, current) => {
        (current[key] as any).forEach((item: any) => {
            result.add(item);
        });
        return result;
    }, new Set<any>).values()) as T[U];
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

function _getReqPath(req: Request): string {
    let path = req.path;
    if (path.charAt(0) == "/") { 
        path = path.substring(1); 
    }
    return path;
}