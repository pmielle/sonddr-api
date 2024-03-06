import { Request, Response, NextFunction } from "express";

import { DbUser } from "sonddr-shared";
import { _getFromReqBody, _getReqPath } from "../handlers";
import { getDocument, getDocuments, patchDocument, putDocument } from "../database";
import { Filter } from "../types";
import { reviveUser, reviveUsers } from "../revivers";


export async function putUser(req: Request, res: Response, next: NextFunction) {
	const payload = {
		id: req["userId"],
		name: _getFromReqBody("name", req),
		date: new Date(),
		externalLinks: [],
		bio: "",
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
	// find links to remove or to add
	const linkToRemove = req.body["removeExternalLink"];
	const linkToAdd = req.body["addExternalLink"];
	if (!linkToRemove && !linkToAdd) { throw new Error(`Both remove- and addExternalLink are missing`); }
	const promises: Promise<void>[] = [];
	if (linkToRemove) {
		promises.push(patchDocument(path, {
			field: 'externalLinks',
			operator: 'pull',
			value: { type: linkToRemove.type },
		}))
	}
	if (linkToAdd) {
		promises.push(patchDocument(path, {
			field: 'externalLinks',
			operator: 'addToSet',
			value: linkToAdd,
		}))
	}
	await Promise.all(promises);
	res.send();
}
