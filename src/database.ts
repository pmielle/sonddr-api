import { MongoClient, ObjectId, BSON, WithId } from "mongodb";
import { Doc, NotFoundError } from "./types";
import crypto from "crypto";

const uri = "mongodb://192.168.1.14:27017,192.168.1.14:27018,192.168.1.14:27019/?replicaSet=rs0&readPreference=primary&ssl=false";
const client = new MongoClient(uri);
const db = client.db("sonddr");

export type Order = {
    field: string,
    desc: boolean,
};

export type Filter = {
    field: string,
    operator: "in"|"eq"|"nin",
    value: any,
};

export async function getDocument<T extends Doc>(path: string): Promise<T> {
    const [collId, docId] = _parseDocumentPath(path);
    const coll = db.collection(collId);
    const query = { _id: _makeMongoId(docId) };
    const dbDoc = await coll.findOne(query);
    if (!dbDoc) {
        throw new NotFoundError();
    }
    const doc = _convertDbDocToDoc(dbDoc);
    return doc as any;  // typescript??
}

export async function getDocuments<T extends Doc>(path: string, order?: Order, filter?: Filter|Filter[]): Promise<T[]> {
    // filter
    let filterObj = filter 
        ? _convertFiltersToDbFilter(Array.isArray(filter) ? filter : [filter]) 
        : {};
    // get
    let cursor =  db.collection(path).find(filterObj);
    // sort
    let sortObj = order 
        ? _convertOrderToDbSort(order) 
        : {};
    cursor = cursor.sort(sortObj);
    // await
    const dbDocs = await cursor.toArray();
    // format
    const docs = dbDocs.map(_convertDbDocToDoc);
    // return
    return docs as any;  // typescript??
}

export async function postDocument(path: string, payload: object): Promise<string> {
    // do not allow "id" in payload
    if ("id" in payload) {
        throw new Error(`id in POST payload is not allowed: use PUT instead`);
    }
    const coll = db.collection(path);
    const result = await coll.insertOne(payload);
    const id = result.insertedId;
    return id.toString();
}

export async function putDocument(path: string, payload: object): Promise<string> {
    const [collId, docId] = _parseDocumentPath(path);
    // handle 2 types of payloads: with or without an "id" field
    if ("id" in payload) {
        if (payload.id !== docId) {
            throw new Error(`Payload id does not match endpoint id: ${payload.id} != ${docId}`);
        }
    } else {
        payload["id"] = docId;
    }
    const dbDoc = _convertDocToDbDoc(payload as Doc);
    const coll = db.collection(collId);
    const result = await coll.insertOne(dbDoc);
    const _id = result.insertedId;
    return _id.toString();
}

export async function deleteDocument(path: string): Promise<void> {
    const [collId, docId] = _parseDocumentPath(path);
    const coll = db.collection(collId);
    const query = { _id: _makeMongoId(docId) };
    let result = await coll.deleteOne(query);
    if (result.deletedCount == 0) {
        throw new Error("0 documents were deleted");
    }
    return;
}

export async function patchDocument<T extends Doc>(path: string, payload: Partial<T>): Promise<void> {
    const [collId, docId] = _parseDocumentPath(path);
    // do not allow "id" update
    if ("id" in payload) {
        throw new Error(`id in PATCH payload is not allowed`);
    }
    const coll = db.collection(collId);
    const query = { _id: _makeMongoId(docId) };
    await coll.updateOne(query, {$set: payload});
    return;
}

// private
// ----------------------------------------------
function _convertOrderToDbSort(order: Order): any { 
    let sortObj: any = {};
    sortObj[order.field] = order.desc ? -1 : 1;
    return sortObj;
}

function _convertFiltersToDbFilter(filters: Filter[]): any {
    // handle value conversions
    filters = filters.map(filter => {
        // values
        const isAnIdField = /[Ii]ds?$/.test(filter.field);
        if (isAnIdField) {
            if (Array.isArray(filter.value)) {
                filter.value = filter.value.map((x: string) => _makeMongoId(x));
            } else {
                filter.value = _makeMongoId(filter.value);
            }
        }
        // fields
        if (filter.field == "id") { filter.field = "_id"; }
        return filter;
    });
    // format as db filter object
    let filterObj: any = {};
    filters.forEach(filter => {
        let filterValue: any = {};
        filterValue[`$${filter.operator}`] = filter.value;
        filterObj[filter.field] = filterValue;
    });
    return filterObj;
}

function _convertDbDocToDoc(dbDoc: WithId<BSON.Document>): Doc {
    const doc: Doc = {id: dbDoc._id.toString()};
    for (const [key, value] of Object.entries(dbDoc)) {
        if (key == "_id") { continue; }
        if (key.endsWith("Id")) { 
            doc[key] = (value as ObjectId).toString();
        } else if (key.endsWith("Ids")) {
            doc[key] = (value as ObjectId[]).map(x => x.toString());
        } else {
            doc[key] = value;
        }
    }
    return doc;
}

function _convertDocToDbDoc(doc: Doc): WithId<BSON.Document> {
    const dbDoc: WithId<BSON.Document> = {_id: _makeMongoId(doc.id)};
    for (const [key, value] of Object.entries(doc)) {
        if (key == "id") { continue; }
        if (key.endsWith("Id")) { 
            doc[key] = _makeMongoId(value as string);
        } else if (key.endsWith("Ids")) {
            doc[key] = (value as string[]).map(x => _makeMongoId(x));
        } else {
            doc[key] = value;
        }
    }
    return dbDoc;
}

// this cannot be changed recklessly because already inserted documents won't be able to be fetched anymore without a patch
function _makeMongoId(id: string): ObjectId {
    const reqLength = 24;
    let objectId: ObjectId;
    try {
        if (id.length == reqLength) {
            objectId = new ObjectId(id);
        } else {
            const hash = crypto.createHash('md5').update(id).digest('hex');
            const hashWithValidLength = hash.slice(0, reqLength);
            objectId = new ObjectId(hashWithValidLength);
        }
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
    return splitResult as any;  // typescript??
}