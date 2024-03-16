import { Request, Response, NextFunction } from "express";
import { deleteDocument, getDocument, putDocument } from "../database.js";
import { Vote, makeVoteId } from "sonddr-shared";
import { _getFromReqBody, _getReqPath } from "../handlers.js";


export async function putVote(req: Request, res: Response, next: NextFunction) {
	const value = _getFromReqBody<number>("value", req);
	if (![1, -1].includes(value)) { throw new Error(`Value must be 1 or -1`); }
	const commentId = _getFromReqBody<string>("commentId", req);
	const userId = req["userId"];
	const voteId = makeVoteId(commentId, userId);
	// put the vote, allow upsert
	await putDocument(_getReqPath(req), {
		id: voteId,
		authorId: userId,
		commentId: commentId,
		value: value,
	}, true);
	res.send();
}

export async function deleteVote(req: Request, res: Response, next: NextFunction) {
	const doc = await getDocument<Vote>(_getReqPath(req));
	if (doc.authorId !== req["userId"]) {
		throw new Error(`${req["userId"]} is not the author of the vote`);
	}
	// delete the vote
	await deleteDocument(_getReqPath(req));
	res.send();
}

