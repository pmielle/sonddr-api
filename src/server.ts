import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import { NotFoundError } from "./types";
import { deleteDocument, getDocument, getDocuments, patchDocument, postDocument, putDocument } from "./database";
import chalk from "chalk";
import { Discussion, Goal } from "sonddr-shared";
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
        const docs = await getDocuments<Goal>(_getReqPath(req), "order");
        res.json(docs);
    } catch(err) { 
        next(err); 
    }
});

app.get('/discussions', keycloak.protect(), async (req, res, next) => {
    try {
        const docs = await getDocuments<Discussion>(_getReqPath(req));
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