import { Request, Response, NextFunction } from "express";

import { Cheer, makeCheerId } from "sonddr-shared";
import { deleteDocument, getDocument, patchDocument, putDocument } from "../database.js";
import { _getFromReqBody, _getReqPath } from "../handlers.js";


export async function putCheer(req: Request, res: Response, next: NextFunction) {
	const ideaId = _getFromReqBody("ideaId", req);
	const userId = req["userId"];
	const id = makeCheerId(ideaId as string, userId);
	const payload = {
		id: id,
		ideaId: ideaId,
		authorId: userId,
	};
	await putDocument(_getReqPath(req), payload);
	await patchDocument(`ideas/${ideaId}`, { field: "supports", operator: "inc", value: 1 });
	res.send();
}

export async function getCheer(req: Request, res: Response, next: NextFunction) {
	const doc = await getDocument<Cheer>(_getReqPath(req));
	res.json(doc);
}

export async function deleteCheer(req: Request, res: Response, next: NextFunction) {
	const doc = await getDocument<Cheer>(_getReqPath(req));
	if (doc.authorId !== req["userId"]) {
		throw new Error(`${req["userId"]} is not the author of the cheer`);
	}
	await patchDocument(`ideas/${doc.ideaId}`, { field: "supports", operator: "inc", value: -1 });
	await deleteDocument(_getReqPath(req));
	res.send();
}
