import { MongoClient, ObjectId } from "mongodb";
import { Doc, NotFoundError } from "./types";

const uri = "mongodb://localhost:27017,localhost:27018,localhost:27019/?replicaSet=rs0&readPreference=primary&ssl=false";
const client = new MongoClient(uri);
const db = client.db("sonddr");

export async function getDocument(path: string): Promise<Doc> {
    const [collId, docId] = _parseDocumentPath(path);
    const coll = db.collection(collId);
    const query = { _id: new ObjectId(docId) };
    let dbDoc = await coll.findOne(query);
    if (!dbDoc) {
        throw new NotFoundError();
    }
    let {_id, ...obj} = dbDoc;
    obj.id = dbDoc._id.toString();
    return obj as any;  // compiler is dumb
}

// private
// ----------------------------------------------
function _parseDocumentPath(path: string): [string, string] {  // returns collection and document ids
    const splitResult = path.split("/").filter(x => x.length > 0);
    if (splitResult.length != 2) {
        throw new Error(`path '${path}' should yield 2 non-empty elements when split to '/'`);
    }
    return splitResult as any;  // compiler is dumb
}