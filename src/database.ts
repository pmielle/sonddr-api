import crypto from "crypto";
import { MongoClient, ObjectId, BSON } from "mongodb";
import { Observable } from "rxjs";

import { Change, Doc } from "sonddr-shared";
import { NotFoundError, Filter, Order, Patch } from "./types.js";


const mongoHost = "database";
const mongoPort = 27017;
const dbName = "sonddr";
const mongoUri = `mongodb://${mongoHost}:${mongoPort}/?replicaSet=${dbName}`;
const client = new MongoClient(mongoUri);
const db = client.db("sonddr");

export function watchCollection<T>(path: string, filter?: Filter | Filter[]): Observable<Change<T>> {
	// build the aggregation pipeline
	const filterObj = filter
		? _convertFiltersToDbFilter(_intoArray(filter), true)
		: {};
	const pipeline = [{ '$match': filterObj }];
	// watch changes
	// fullDocumentBeforeChanges is only available for mongodb v6
	const changes = db.collection(path).watch(pipeline, { fullDocument: "updateLookup", fullDocumentBeforeChange: "whenAvailable" });
	return new Observable((subscriber) => {
		changes.on("change", (change) => {
			switch (change.operationType) {

				case "delete": {
					const dbDoc = change.fullDocumentBeforeChange;
					const docBefore = _convertDbDocToDoc(dbDoc);
					const docId = docBefore.id;
					subscriber.next({
						type: "delete",
						docId: docId,
						docBefore: docBefore as T,
						docAfter: undefined,
					});
					break;
				}

				case "insert": {
					const dbDoc = change.fullDocument;
					const docAfter = _convertDbDocToDoc(dbDoc);
					const docId = docAfter.id;
					subscriber.next({
						type: "insert",
						docId: docId,
						docBefore: undefined,
						docAfter: docAfter as T,
					});
					break;
				}

				case "update": {
					const dbDocBefore = change.fullDocumentBeforeChange;
					const dbDocAfter = change.fullDocument;
					const docBefore = _convertDbDocToDoc(dbDocBefore);
					const docAfter = _convertDbDocToDoc(dbDocAfter);
					const docId = docAfter.id;
					subscriber.next({
						type: "update",
						docId: docId,
						docAfter: docAfter as T,
						docBefore: docBefore as T,
					});
					break;
				}

				case "replace": {
					const dbDocBefore = change.fullDocumentBeforeChange;
					const dbDocAfter = change.fullDocument;
					const docBefore = _convertDbDocToDoc(dbDocBefore);
					const docAfter = _convertDbDocToDoc(dbDocAfter);
					const docId = docAfter.id;
					subscriber.next({
						type: "update",
						docId: docId,
						docAfter: docAfter as T,
						docBefore: docBefore as T,
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
	return doc as any;
}

export async function getDocuments<T extends Doc>(path: string, order?: Order, filter?: Filter | Filter[]): Promise<T[]> {
	// filter
	let filterObj = filter
		? _convertFiltersToDbFilter(_intoArray(filter))
		: {};
	// get
	let cursor = db.collection(path).find(filterObj);
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
	return docs as any;
}

// returns the number of deleted documents
export async function deleteDocuments(path: string, filter: Filter | Filter[]): Promise<number> {
	// filter
	let filterObj = filter
		? _convertFiltersToDbFilter(_intoArray(filter))
		: {};
	// delete
	const result = await db.collection(path).deleteMany(filterObj);
	return result.deletedCount;
}

// returns the id of the inserted document
// id is not allowed in the payload: use putDocument for this
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

// does not upsert by default
// the id can either be in the url or in the payload
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
		await coll.replaceOne(query, dbDoc, { upsert: true });
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

export async function patchDocument(path: string, patches: Patch | Patch[]): Promise<void> {
	const [collId, docId] = _parseDocumentPath(path);
	let patchObj = _convertPatchesToDbPatch(_intoArray(patches));
	const coll = db.collection(collId);
	const query = { _id: makeMongoId(docId) };
	await coll.updateOne(query, patchObj);
	return;
}

// this cannot be changed recklessly: 
// already inserted documents won't be able to be fetched anymore
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
	} catch (err) {
		if (err instanceof BSON.BSONError) {
			throw new Error(`Failed to convert ${id} into a mongo ObjectId: ${err}`);
		}
		throw err;
	}
	return objectId;
}


// private
// ----------------------------------------------
function _intoArray<T>(val: T|T[]): T[] {
	return Array.isArray(val) 
		? val
		: [val];
}

// returns collection and document ids
function _parseDocumentPath(path: string): [string, string] {
	const splitResult = path.split("/").filter(x => x.length > 0);
	if (splitResult.length != 2) {
		throw new Error(`path '${path}' should yield 2 non-empty elements when split to '/'`);
	}
	return splitResult as any;
}

// id fields are fields that contains either an id or an array of ids
// e.g. authorId, goalIds
function _isAnIdField(field: string): boolean {
	return /[Ii]ds?$/.test(field);
} 

function _convertIdsIntoMongoIds(value: any): any {
	return Array.isArray(value) 
		? value.map((x: string) => makeMongoId(x))
		: makeMongoId(value);
} 

function _convertPatchesToDbPatch(patches: Patch[]): any {
	// id fields values need to be converted into mongoIds
	patches = patches.map(patch => {
		// fields
		if (patch.field == "id") { throw new Error("id field can't be patched"); }
		// values
		if (_isAnIdField(patch.field)) {
			patch.value = _convertIdsIntoMongoIds(patch.value);
		}
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

// won't work on id fields
function _convertOrderToDbSort(order: Order): any {
	let sortObj: any = {};
	sortObj[order.field] = order.desc ? -1 : 1;
	return sortObj;
}

function _convertFiltersToDbFilter(filters: Filter[], addFullDocument = false): any {
	// id fields values need to be converted into mongoIds
	filters = filters.map(filter => {
		// fields
		if (filter.field == "id") { filter.field = "_id"; }
		// values
		if (_isAnIdField(filter.field)) {
			filter.value = _convertIdsIntoMongoIds(filter.value);
		}
		return filter;
	});
	// format as db filter object
	let filterObj: any = {};
	filters.forEach(filter => {
		// field
		if (addFullDocument) { filter.field = `fullDocument.${filter.field}` }
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
	const doc: Doc = { id: dbDoc._id.toString() };
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
