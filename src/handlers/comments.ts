import { Request, Response, NextFunction } from "express";

import { Comment, DbComment, DbUser, Vote, makeVoteId } from "sonddr-shared";
import { deleteDocument, getDocument, getDocuments, postDocument } from "../database.js";
import { _getFromReqBody, _getReqPath, _getUnique } from "../handlers.js";
import { reviveUser, reviveUsers } from "../revivers.js";
import { Filter, NotFoundError } from "../types.js";


export async function postComment(req: Request, res: Response, next: NextFunction) {
	const payload = {
		ideaId: _getFromReqBody("ideaId", req),
		content: _getFromReqBody("content", req),
		authorId: req["userId"],
		date: new Date(),
		rating: 0,
	};
	const insertedId = await postDocument(_getReqPath(req), payload);
	res.json({ insertedId: insertedId });
}

export async function deleteComment(req: Request, res: Response, next: NextFunction) {
	const comment = await getDocument<DbComment>(_getReqPath(req));
	if (comment.authorId !== req["userId"]) { throw new Error("Unauthorized"); }
	await deleteDocument(_getReqPath(req));
	res.send();
}

export async function getComments(req: Request, res: Response, next: NextFunction) {
	const order = req.query.order || "date";
	const ideaId = req.query.ideaId;
	const authorId = req.query.authorId;
	const filters: Filter[] = [];
	if (ideaId) {
		filters.push({ field: "ideaId", operator: "eq", value: ideaId });
	}
	if (authorId) {
		filters.push({ field: "authorId", operator: "eq", value: authorId });
	}
	const dbDocs = await getDocuments<DbComment>(
		_getReqPath(req),
		{ field: order as string, desc: true },
		filters
	);
	if (dbDocs.length == 0) {
		res.json([]);
		return;
	}
	const authorsToGet = _getUnique(dbDocs, "authorId");
	const votesToGet = _getUnique(dbDocs, "id");
	const [authors, votes] = await Promise.all([
		getDocuments<DbUser>("users", undefined, { field: "id", operator: "in", value: authorsToGet })
			.then(dbDocs => reviveUsers(dbDocs, req["userId"])),
		getDocuments<Vote>("votes", undefined, [
			{ field: "commentId", operator: "in", value: votesToGet },
			{ field: "authorId", operator: "eq", value: req["userId"] },
		]),
	]);

	const docs: Comment[] = dbDocs.map((dbDoc) => {
		const { authorId, ...data } = dbDoc;
		data["author"] = authors.find(u => u.id === authorId);
		const vote = votes.find(v => v.commentId === dbDoc.id);  // might be undefined
		data["userVote"] = vote ? vote.value : undefined;
		return data as any;
	});
	res.json(docs);
}

export async function getComment(req: Request, res: Response, next: NextFunction) {
	const dbDoc = await getDocument<DbComment>(_getReqPath(req));
	const user = await getDocument<DbUser>(`users/${dbDoc.authorId}`)
		.then(dbDoc => reviveUser(dbDoc, req["userId"]));
	const { authorId, ...doc } = dbDoc;
	doc["author"] = user;
	try {
		const voteId = makeVoteId(dbDoc.id, req["userId"]);
		const vote = await getDocument<Vote>(`votes/${voteId}`);
		doc["userVote"] = vote.value;
	} catch (err) { if (!(err instanceof NotFoundError)) { throw err; } }
	res.json(doc);
}
