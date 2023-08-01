import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import { NotFoundError } from "./types";
import { getDocument } from "./database";

const port = 3000;
const app = express();
app.use(cors({origin: "http://localhost:4200"}));

app.get('/toto/:id', async (req, res, next) => {
    try {
        const doc = await getDocument(req.path);
        res.json(doc);
    } catch(err) { 
        next(err); 
    }
});

app.use(_errorHandler);

app.listen(port, () => {
    console.log(`Listening on port ${port}`);
});


// private
// ----------------------------------------------
function _errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
    console.error(err);
    if (err instanceof NotFoundError) {
        res.status(404).send();
    } else {
        res.status(500).send();
    }
}