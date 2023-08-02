import { MongoClient, ObjectId, BSON } from "mongodb";
import { Doc, NotFoundError } from "./types";
import crypto from "crypto";

const uri = "mongodb://localhost:27017,localhost:27018,localhost:27019/?replicaSet=rs0&readPreference=primary&ssl=false";
const client = new MongoClient(uri);
const db = client.db("sonddr");

export async function getDocument(path: string): Promise<Doc> {
    const [collId, docId] = _parseDocumentPath(path);
    const coll = db.collection(collId);
    const query = { _id: _makeMongoId(docId) };
    console.log(query);
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
// this cannot be changed recklessly because already inserted documents won't be able to be fetched anymore without a patch
function _makeMongoId(id: string): ObjectId {
    const reqLength = 24;
    let objectId: ObjectId;
    try {
        const hash = crypto.createHash('md5').update(id).digest('hex');
        const hashWithValidLength = hash.slice(0, reqLength);
        objectId = new ObjectId(hashWithValidLength);
    } catch(err) {
        if (err instanceof BSON.BSONError) {
            throw new Error(`Failed to convert ${id} into a mongo ObjectId: ${err}`);
        }
        throw err;
    }
    return objectId;
}

function _parseDocumentPath(path: string): [string, string] {  // returns collection and document ids
    const splitResult = path.split("/").filter(x => x.length > 0);
    if (splitResult.length != 2) {
        throw new Error(`path '${path}' should yield 2 non-empty elements when split to '/'`);
    }
    return splitResult as any;  // compiler is dumb
}