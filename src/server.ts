import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import { Doc, NotFoundError } from "./types";
import { Filter, Order, deleteDocument, getDocument, getDocuments, patchDocument, postDocument, putDocument } from "./database";
import chalk from "chalk";
import { DbComment, DbIdea, Discussion, Goal, Idea, User } from "sonddr-shared";
import session from "express-session";
import KeycloakConnect from "keycloak-connect";

const port = 3000;
const app = express();
app.use(express.json());  // otherwise req.body is undefined
app.use(cors({origin: "http://localhost:4200"}));  // otherwise can't be reached by front

// authentication
// ----------------------------------------------
const memoryStore = new session.MemoryStore();
app.use(session({secret: 'some secret', saveUninitialized: true, resave: false, store: memoryStore}));
const keycloak = new KeycloakConnect({store: memoryStore});  // reads keycloak.json
app.use(keycloak.middleware());

// routes
// ----------------------------------------------
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

app.get('/ideas/:id', keycloak.protect(), async (req, res, next) => {
    try {
        const dbDoc = await getDocument<DbIdea>(_getReqPath(req));
        const [author, goals] = await Promise.all([
            getDocument<User>(`users/${dbDoc.authorId}`),
            getDocuments<Goal>("goals", {field: "name", desc: false}, {field: "id", operator: "in", value: dbDoc.goalIds})
        ]);
        const {authorId, goalIds, ...data} = dbDoc;
        data["author"] = author;
        data["goals"] = goals;
        const doc: Idea = data as Idea;
        res.json(doc);
    } catch(err) { 
        next(err); 
    }
});

app.get('/ideas', keycloak.protect(), async (req, res, next) => {
    try {
        const order = req.query.order || "date";
        const goalId = req.query.goalId;
        const authorId = req.query.authorId;
        const filters: Filter[] = [];    
        if (goalId) {
            filters.push({field: "goalIds", operator: "in", value: [goalId]});
        }    
        if (authorId) {
            filters.push({field: "authorId", operator: "eq", value: authorId});
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
        const [authors, goals] = await Promise.all([
            getDocuments<User>("users", {field: "name", desc: false}, {field: "id", operator: "in", value: authorsToGet}),
            getDocuments<Goal>("goals", {field: "name", desc: false}, {field: "id", operator: "in", value: goalsToGet})
        ]);
        const docs: Idea[] = dbDocs.map((dbDoc) => {
            const {authorId, goalIds, ...data} = dbDoc;
            data["author"] = authors.find(u => u.id === authorId);
            data["goals"] = goals.filter(g => goalIds.includes(g.id));
            return data as any // typescript?? 
        });
        res.json(docs);
    } catch(err) { 
        next(err); 
    }
});

app.get('/comments', keycloak.protect(), async (req, res, next) => {
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
        const authors = await getDocuments<User>("users", {field: "name", desc: false}, {field: "id", operator: "in", value: authorsToGet});
        const docs: Comment[] = dbDocs.map((dbDoc) => {
            const {authorId, ...data} = dbDoc;
            data["author"] = authors.find(u => u.id === authorId);
            return data as any // typescript?? 
        });
        res.json(docs);
    } catch(err) { 
        next(err); 
    }
});

app.get('/discussions', keycloak.protect(), async (req, res, next) => {
    try {
        const docs = await getDocuments<Discussion>(_getReqPath(req), {field: "name", desc: false});
        res.json(docs);
    } catch(err) { 
        next(err); 
    }
});


// error handling
// ----------------------------------------------
app.use(_errorHandler);

app.listen(port, () => {
    console.log(`Listening on port ${port}`);
    console.log(`\n`);
});


// private
// ----------------------------------------------
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