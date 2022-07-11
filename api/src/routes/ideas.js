import { getCollection, getDocument } from "../database/database.js"

export function addIdeasRoutes(app) {

    const endpoint = "/ideas"
    const databaseCollectionId = "ideas"

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

}