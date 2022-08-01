import { addToCollection, getCollection, getDocument } from "../database/database.js"

export function addIdeasRoutes(app) {

    const endpoint = "/ideas"
    const databaseCollectionId = "ideas"


    // GET
    // ---
    app.get(endpoint, async (req, res, next) => {
        try {
            res.json(await getCollection(databaseCollectionId))
        } catch (err) { next(err) }
    })

    app.get(`${endpoint}/:id`, async (req, res, next) => {
        try {
            res.json(await getDocument(databaseCollectionId, req.params.id))
        } catch (err) { next(err) }
    })

    // POST
    // ----
    app.post(endpoint, async (req, res, next) => {
        // convert string timestamp into date
        req.body.date = new Date(req.body.date)  // <-- FIXME: never fails...
        try {
            // post
            res.json(await addToCollection(databaseCollectionId, req.body))
        } catch (err) { next(err) }
    })

}