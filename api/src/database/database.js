import { MongoClient } from "mongodb"


// properties
// ----------------------------------------------
let database = null
const databaseHost = "database"
const databasePort = 27017
const webUser=process.env.MONGO_WEB_USER
const webPassword=process.env.MONGO_WEB_PASSWORD
const databaseName=process.env.MONGO_DATABASE
const mongoUrl = `mongodb://${webUser}:${webPassword}@${databaseHost}:${databasePort}/${databaseName}`


// methods
// ----------------------------------------------
// connect
// -------
export async function connectToDatabase() {
    const connection = await MongoClient.connect(mongoUrl)
    database = connection.db()
}

async function getDatabase() {
    if (!database) { await connectToDatabase() }
    return database
}

// get
// ---
export async function getDocument(collectionId, documentId) {
    let database = await getDatabase()
    return await database.collection(collectionId).findOne({_id: documentId})
}

export async function getCollection(collectionId) {
    let database = await getDatabase()
    return await database.collection(collectionId).find({}).toArray()
}

// post
// ----
export async function addToCollection(collectionId, document) {
    let database = await getDatabase()
    let response = await database.collection(collectionId).insertOne(document)
    return {id: response.insertedId}
}

// update
// ------
export async function updateDocument(collectionId, documentId, update) {
    let database = await getDatabase()
    return await database.collection(collectionId).updateOne({_id: documentId}, update)
}

// delete
// ------
export async function deleteDocument(collectionId, documentId) {
    let database = await getDatabase()
    return await database.collection(collectionId).deleteOne({_id: documentId})
}