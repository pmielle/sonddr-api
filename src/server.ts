import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import { NotFoundError } from "./types";
import { deleteDocument, getDocument, getDocuments, patchDocument, postDocument, putDocument } from "./database";
import chalk from "chalk";


const port = 3000;
const app = express();
app.use(express.json());  // otherwise req.body is undefined
app.use(cors({origin: "http://localhost:4200"}));  // otherwise can't be reached by front


// routes
// ----------------------------------------------
app.get('/tests/:id', async (req, res, next) => {
    try {
        const doc = await getDocument(_getReqPath(req));
        res.json(doc);
    } catch(err) { 
        next(err); 
    }
});

app.get('/tests', async (req, res, next) => {
    try {
        const docs = await getDocuments(_getReqPath(req));
        res.json(docs);
    } catch(err) { 
        next(err); 
    }
});

app.post('/tests', async (req, res, next) => {
    try {
        const id = await postDocument(_getReqPath(req), req.body);
        res.json(id);
    } catch(err) { 
        next(err); 
    }
});

app.put('/tests/:id', async (req, res, next) => {
    try {
        const id = await putDocument(_getReqPath(req), req.body);
        res.json(id);
    } catch(err) { 
        next(err); 
    }
});

app.patch('/tests/:id', async (req, res, next) => {
    try {
        await patchDocument(_getReqPath(req), req.body);
        res.status(200).send();
    } catch(err) { 
        next(err); 
    }
});

app.delete('/tests/:id', async (req, res, next) => {
    try {
        await deleteDocument(_getReqPath(req));
        res.status(200).send();
    } catch(err) { 
        next(err); 
    }
});


// error handling
// ----------------------------------------------
app.use(_errorHandler);


app.listen(port, () => {
    console.log(`Listening on port ${port}`);
    console.log(`\n\n`);
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