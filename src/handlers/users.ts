import { Request, Response, NextFunction } from "express";

import { DbUser } from "sonddr-shared";
import { _getFromReqBody, _getReqPath } from "../handlers.js";
import { getDocument, getDocuments, patchDocument, putDocument } from "../database.js";
import { Filter, Patch } from "../types.js";
import { reviveUser, reviveUsers } from "../revivers.js";


export async function putUser(req: Request, res: Response, next: NextFunction) {
	const payload = {
		id: req["userId"],
		name: _getFromReqBody("name", req),
		date: new Date(),
		externalLinks: [],
		bio: "",
		cover: undefined,
	};
	await putDocument(_getReqPath(req), payload);
	res.send();
}

export async function getUser(req: Request, res: Response, next: NextFunction) {
	const doc = await getDocument<DbUser>(_getReqPath(req))
		.then(dbDoc => reviveUser(dbDoc, req["userId"]));
	res.json(doc);
}

export async function getUsers(req: Request, res: Response, next: NextFunction) {
	const regex = req.query.regex;
	const filters: Filter[] = [];
	if (regex) {
		filters.push({ field: "name", operator: "regex", value: regex });
	}
	const users = await getDocuments<DbUser>(
		_getReqPath(req),
		{ field: 'name', desc: false },
		filters
	).then(dbDocs => reviveUsers(dbDocs, req["userId"]));
	res.json(users);
}

export async function patchUser(req: Request, res: Response, next: NextFunction) {
	// only the user is allowed to edits its external links
	const path = _getReqPath(req);
	const userId = req.params["id"];
	if (!userId === req["userId"]) { throw new Error(`Unauthorized`); }
	// scalar fields updates
	// all in a single update op
	const patches: Patch[] = [];
	const newName = req.body["name"];
	if (newName) { patches.push({ field: "name", operator: "set", value: newName }); }
	const newBio = req.body["bio"];
	if (newBio) { patches.push({ field: "bio", operator: "set", value: newBio }); }
	const cover: Express.Multer.File | undefined = req.file;
	console.log(cover);
	if (cover !== undefined) { patches.push({ operator: "set", field: "cover", value: cover.filename }); }
	if (patches.length > 0) { await patchDocument(path, patches); }
	// find links to remove or to add
	// can't be done in parallel otherwise race condition
	const linkToRemove = req.body["removeExternalLink"];
	const linkToAdd = req.body["addExternalLink"];
	if (linkToRemove) {
		await patchDocument(path, {
			field: 'externalLinks',
			operator: 'pull',
			value: { type: linkToRemove.type },
		});
	}
	if (linkToAdd) {
		await patchDocument(path, {
			field: 'externalLinks',
			operator: 'addToSet',
			value: linkToAdd,
		});
	}
	res.send();
}
