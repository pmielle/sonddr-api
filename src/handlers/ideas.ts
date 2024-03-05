import { Request, Response, NextFunction } from "express";

import { Cheer, DbIdea, DbUser, Goal, Idea, makeCheerId } from "sonddr-shared";
import { Filter, NotFoundError, Patch } from "../types";
import { deleteDocument, getDocument, getDocuments, patchDocument, postDocument } from "../database";
import { _getFromReqBody, _getReqPath, _getUnique, _getUniqueInArray } from "../handlers";
import { basePath } from "../routes";
import { multerPath } from "../uploads";
import { reviveUser, reviveUsers } from "../revivers";


export async function getIdeas(req: Request, res: Response, next: NextFunction) {
	const order = req.query.order || "date";
	const goalId = req.query.goalId;
	const authorId = req.query.authorId;
	const regex = req.query.regex;
	const filters: Filter[] = [];
	if (goalId) {
		filters.push({ field: "goalIds", operator: "in", value: [goalId] });
	}
	if (authorId) {
		filters.push({ field: "authorId", operator: "eq", value: authorId });
	}
	if (regex) {
		filters.push({ field: "title", operator: "regex", value: regex });
	}
	const dbDocs = await getDocuments<DbIdea>(
		_getReqPath(req),
		{ field: order as string, desc: true },
		filters
	);
	if (dbDocs.length == 0) {
		res.json([]);
		return;
	}
	const authorsToGet = _getUnique(dbDocs, "authorId");
	const goalsToGet = _getUniqueInArray(dbDocs, "goalIds");
	const cheersToGet = _getUnique(dbDocs, "id");
	const [authors, goals, cheers] = await Promise.all([
		getDocuments<DbUser>("users", undefined, { field: "id", operator: "in", value: authorsToGet })
			.then(dbDocs => reviveUsers(dbDocs, req["userId"])),
		getDocuments<Goal>("goals", undefined, { field: "id", operator: "in", value: goalsToGet }),
		getDocuments<Cheer>("cheers", undefined, [
			{ field: "ideaId", operator: "in", value: cheersToGet },
			{ field: "authorId", operator: "eq", value: req["userId"] },
		]),
	]);

	const docs: Idea[] = dbDocs.map((dbDoc) => {
		const { authorId, goalIds, ...data } = dbDoc;
		data["author"] = authors.find(u => u.id === authorId);
		data["goals"] = goals.filter(g => goalIds.includes(g.id));
		data["userHasCheered"] = cheers.find(c => c.ideaId === dbDoc.id) ? true : false;
		return data as any;
	});
	res.json(docs);
}

export async function getIdea(req: Request, res: Response, next: NextFunction) {
	const dbDoc = await getDocument<DbIdea>(_getReqPath(req));
	const cheerId = makeCheerId(dbDoc.id, req["userId"]);
	const [author, goals, userHasCheered] = await Promise.all([
		getDocument<DbUser>(`users/${dbDoc.authorId}`).then(dbDoc => reviveUser(dbDoc, req["userId"])),
		getDocuments<Goal>("goals", undefined, { field: "id", operator: "in", value: dbDoc.goalIds }),
		getDocument<Cheer>(`cheers/${cheerId}`)
			.then(() => true)
			.catch<boolean>(err => {
				if (!(err instanceof NotFoundError)) { throw err; }
				return false;
			}),
	]);
	const { authorId, goalIds, ...data } = dbDoc;
	data["author"] = author;
	data["goals"] = goals;
	data["userHasCheered"] = userHasCheered;
	data["content"] = _fixImageSources(data["content"]);
	res.json(data);
}

export async function postIdea(req: Request, res: Response, next: NextFunction) {
	let content = _getFromReqBody<string>("content", req);
	const cover: Express.Multer.File | undefined = req.files["cover"]?.pop();
	const images: Express.Multer.File[] | undefined = req.files["images"];
	images?.forEach((image) => {
		content = content.replace(
			new RegExp(`<img src=".+?" id="${image.originalname}">`),
			`<img src="${image.filename}">`
		);
	});
	const payload = {
		title: _getFromReqBody("title", req),
		authorId: req["userId"],
		goalIds: JSON.parse(_getFromReqBody("goalIds", req)),
		content: content,
		externalLinks: [],
		date: new Date(),
		supports: 0,
		cover: cover ? cover.filename : undefined,
	};
	const insertedId = await postDocument(_getReqPath(req), payload);
	res.json({ insertedId: insertedId });
}

export async function deleteIdea(req: Request, res: Response, next: NextFunction) {
	const idea = await getDocument<DbIdea>(_getReqPath(req));
	if (idea.authorId !== req["userId"]) { throw new Error("Unauthorized"); }
	await deleteDocument(_getReqPath(req));
	res.send();
}

export async function patchIdea(req: Request, res: Response, next: NextFunction) {
	// only the idea author is allowed to edit
	const path = _getReqPath(req);
	const idea = await getDocument<DbIdea>(path);
	if (!idea) { throw new Error(`Idea not found`); }
	if (!idea.authorId === req["userId"]) { throw new Error(`Unauthorized`); }

	// find fields to update
	let content = req.body["content"];
	const title = req.body["title"];
	const goalIds = req.body["goalIds"];
	const cover: Express.Multer.File | undefined = req.files?.["cover"]?.pop();
	if (content !== undefined) {
		const images: Express.Multer.File[] | undefined = req.files?.["images"];
		images?.forEach((image) => {
			content = content.replace(
				new RegExp(`<img src=".+?" id="${image.originalname}">`),
				`<img src="${image.filename}">`
			);
		});
		// images that were already present should be re-formatted to remove any prefix added by the frontend
		content = content.replace(/<img src=".*\/(\w+)">/g, `<img src="$1">`);
	}
	let patches: Patch[] = [];
	if (content !== undefined) { patches.push({ operator: "set", field: "content", value: content }); }
	if (title !== undefined) { patches.push({ operator: "set", field: "title", value: title }); }
	if (goalIds !== undefined) { patches.push({ operator: "set", field: "goalIds", value: JSON.parse(goalIds) }); }
	if (cover !== undefined) { patches.push({ operator: "set", field: "cover", value: cover.filename }); }
	if (patches.length > 0) {
		await patchDocument(path, patches);
	}

	// find links to remove or to add
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

	// respond
	res.send();
}

// private
// --------------------------------------------
function _fixImageSources(content: string) {
	return content.replaceAll(
		/<img src="(.+?)">/g,
		`<img src="${basePath}/${multerPath}/$1">`
	);
}

