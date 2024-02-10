import { MongoClient, ObjectId, BSON } from "mongodb";
import { NotFoundError } from "./types.js";
import crypto from "crypto";
import { Observable } from "rxjs";
import { Change, Doc } from "sonddr-shared";

const uri = "mongodb://database:27017/?replicaSet=sonddr";
const client = new MongoClient(uri);
const db = client.db("sonddr");

export type Order = {
    field: string,
    desc: boolean,
};

export type Filter = {
    field: string,
    operator: "in"|"eq"|"nin"|"regex",
    value: any,
};

export type Patch = {
    field: string,
    operator: "set"|"inc"|"addToSet"|"pull",
    value: any,
};

export function watchCollection<T>(path: string, filter?: Filter|Filter[]): Observable<Change<T>> {
    // build the aggregation pipeline
    const filterObj = filter 
        ? _convertFiltersToDbFilter(Array.isArray(filter) ? filter : [filter], true) 
        : {};
    const pipeline = [{'$match': filterObj}];
    // watch changes
    // fullDocumentBeforeChanges is only available for mongodb v6
    const changes = db.collection(path).watch(pipeline, {fullDocument: "updateLookup", fullDocumentBeforeChange: "whenAvailable"});
    return new Observable((subscriber) => {
        changes.on("change", (change) => {
            switch (change.operationType) {

                case "delete": {
		    const dbDoc = change.fullDocumentBeforeChange;	
		    const payload = _convertDbDocToDoc(dbDoc);
                    const docId = change.documentKey._id.toString();
                    subscriber.next({
                        type: "delete", 
                        docId: docId,
                        payload: payload as T,
                    });
                    break;
                }

                case "insert": {
                    const dbDoc = change.fullDocument;
                    const payload = _convertDbDocToDoc(dbDoc);
                    const docId = payload.id;
                    subscriber.next({
                        type: "insert", 
                        docId: docId, 
                        payload: payload as T,
                    });
                    break;
                }

                case "update": {
                    const dbDoc = change.fullDocument;
                    const payload = _convertDbDocToDoc(dbDoc);
                    const docId = payload.id;
                    subscriber.next({
                        type: "update", 
                        docId: docId, 
                        payload: payload as T,
                    });
                    break;
                }

                case "replace": {
                    const dbDoc = change.fullDocument;
                    const payload = _convertDbDocToDoc(dbDoc);
                    const docId = payload.id;
                    subscriber.next({
                        type: "update", 
                        docId: docId, 
                        payload: payload as T,
                    });
                    break;
                }

                default: {
                    return;
                }
            }

        });
        changes.on("error", (err) => subscriber.error(err));

        return () => {
            changes.close();
        };

    });
}

export async function getDocument<T extends Doc>(path: string): Promise<T> {
    const [collId, docId] = _parseDocumentPath(path);
    const coll = db.collection(collId);
    const query = { _id: makeMongoId(docId) };
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

// returns the number of deleted documents
export async function deleteDocuments(path: string, filter: Filter|Filter[]): Promise<number> {
	// filter
	let filterObj = filter 
		? _convertFiltersToDbFilter(Array.isArray(filter) ? filter : [filter]) 
		: {};
	// delete
	const result = await db.collection(path).deleteMany(filterObj);
	return result.deletedCount;
}

export async function postDocument(path: string, payload: object): Promise<string> {
    // do not allow "id" in payload
    if ("id" in payload) {
        throw new Error(`id in POST payload is not allowed: use PUT instead`);
    }
    const coll = db.collection(path);
    const dbDoc = _convertDocToDbDoc(payload, false);
    const result = await coll.insertOne(dbDoc);
    const id = result.insertedId;
    return id.toString();
}

export async function putDocument(path: string, payload: object, upsert: boolean = false): Promise<void> {
    const [collId, docId] = _parseDocumentPath(path);
    // handle 2 types of payloads with or without "id" field
    if ("id" in payload) {
        const pathMongoId = makeMongoId(docId);
        const payloadMongoId = makeMongoId(docId);
        if (pathMongoId.toString() !== payloadMongoId.toString()) {
            throw new Error(`Payload id does not match endpoint id: ${payloadMongoId} != ${pathMongoId}`);
        }
    } else {
        payload["id"] = docId;
    }
    const dbDoc = _convertDocToDbDoc(payload, true);
    const coll = db.collection(collId);
    if (upsert) {
        const query = { _id: makeMongoId(docId) };
        await coll.replaceOne(query, dbDoc, {upsert: true});
    } else {
        await coll.insertOne(dbDoc);
    }
}

export async function deleteDocument(path: string): Promise<void> {
    const [collId, docId] = _parseDocumentPath(path);
    const coll = db.collection(collId);
    const query = { _id: makeMongoId(docId) };
    let result = await coll.deleteOne(query);
    if (result.deletedCount == 0) {
        throw new Error("0 documents were deleted");
    }
    return;
}

export async function patchDocument(path: string, patches: Patch|Patch[]): Promise<void> {
    const [collId, docId] = _parseDocumentPath(path);
    let patchObj = _convertPatchesToDbPatch(Array.isArray(patches) ? patches : [patches]);
    const coll = db.collection(collId);
    const query = { _id: makeMongoId(docId) };
    await coll.updateOne(query, patchObj);
    return;
}

// this cannot be changed recklessly because already inserted documents won't be able to be fetched anymore without a patch
export function makeMongoId(id: string): ObjectId {
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

// private
// ----------------------------------------------
function _convertPatchesToDbPatch(patches: Patch[]): any {
    // handle value conversions
    patches = patches.map(patch => {
        // values
        const isAnIdField = /[Ii]ds?$/.test(patch.field);
        if (isAnIdField) {
            if (Array.isArray(patch.value)) {
                patch.value = patch.value.map((x: string) => makeMongoId(x));
            } else {
                patch.value = makeMongoId(patch.value);
            }
        }
        // fields
        if (patch.field == "id") { throw new Error("id field can't be patched"); }
        return patch;
    });
    // format as db update object
    let patchObj: any = {};
    patches.forEach(patch => {
        const operatorKey = `$${patch.operator}`;
        if (operatorKey in patchObj) {
            patchObj[operatorKey][patch.field] = patch.value;
        } else {
            const value: any = {};
            value[patch.field] = patch.value;
            patchObj[operatorKey] = value;
        }            
    });
    return patchObj;
}

function _convertOrderToDbSort(order: Order): any { 
    let sortObj: any = {};
    sortObj[order.field] = order.desc ? -1 : 1;
    return sortObj;
}

function _convertFiltersToDbFilter(filters: Filter[], addFullDocument = false): any {
    // handle value conversions
    filters = filters.map(filter => {
        // values
        const isAnIdField = /[Ii]ds?$/.test(filter.field);
        if (isAnIdField) {
            if (Array.isArray(filter.value)) {
                filter.value = filter.value.map((x: string) => makeMongoId(x));
            } else {
                filter.value = makeMongoId(filter.value);
            }
        }
        // fields
        if (filter.field == "id") { filter.field = "_id"; }
        return filter;
    });
    // format as db filter object
    let filterObj: any = {};
    filters.forEach(filter => {
        // field
        if (addFullDocument) { filter.field = `fullDocument.${filter.field}`}
        // value
        let filterValue: any = {};
        filterValue[`$${filter.operator}`] = filter.value;
        if (filter.operator === "regex") {
            filterValue['$options'] = 'i';  // case insensitive
        }
        // assign
        filterObj[filter.field] = filterValue;
    });
    return filterObj;
}

function _convertDbDocToDoc(dbDoc: BSON.Document): Doc {
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

function _convertDocToDbDoc(doc: any, withId: boolean): any {
    let dbDoc = {};
    if (withId) {
        let mongoId: ObjectId;
        if ("_id" in doc) {
            mongoId = makeMongoId(doc._id);
        } else if ("id" in doc) {
            mongoId = makeMongoId(doc.id);
        } else {
            throw new Error("Found neither '_id' nor 'id' in document");
        }
        dbDoc["_id"] = mongoId;
    }
    for (const [key, value] of Object.entries(doc)) {
        if (key == "id") { continue; }
        if (key.endsWith("Id")) { 
            dbDoc[key] = makeMongoId(value as string);
        } else if (key.endsWith("Ids")) {
            dbDoc[key] = (value as string[]).map(x => makeMongoId(x));
        } else {
            dbDoc[key] = value;
        }
    }
    return dbDoc;
}

function _parseDocumentPath(path: string): [string, string] {  // returns collection and document ids
    const splitResult = path.split("/").filter(x => x.length > 0);
    if (splitResult.length != 2) {
        throw new Error(`path '${path}' should yield 2 non-empty elements when split to '/'`);
    }
    return splitResult as any;  // typescript??
}
