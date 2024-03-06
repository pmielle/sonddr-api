import { Request, Response, NextFunction } from "express";
import { deleteDocument, getDocument, patchDocument, putDocument } from "../database";
import { Vote, makeVoteId } from "sonddr-shared";
import { _getFromReqBody, _getReqPath } from "../handlers";
import { NotFoundError } from "../types";


export async function putVote(req: Request, res: Response, next: NextFunction) {
	const value = _getFromReqBody<number>("value", req);
	if (![1, -1].includes(value)) { throw new Error(`Value must be 1 or -1`); }
	const commentId = _getFromReqBody<string>("commentId", req);
	const userId = req["userId"];
	const voteId = makeVoteId(commentId, userId);
	// get previous vote value to determine the new comment rating
	const previousValue = await getDocument<Vote>(_getReqPath(req))
	.then(v => v.value)
	.catch(err => {
		if (!(err instanceof NotFoundError)) { throw err; }
		return 0;
	});
	const valueDiff = value - previousValue;
	if (valueDiff !== 0) {
		await patchDocument(
			`comments/${commentId}`,
			{ field: "rating", operator: "inc", value: valueDiff },
		);
	}
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
	// get previous value and patch the rating of the comment
	const previousValue = await getDocument<Vote>(_getReqPath(req))
	.then(v => v.value)
	.catch(err => {
		if (!(err instanceof NotFoundError)) { throw err; }
		return 0;
	});
	await patchDocument(`comments/${doc.commentId}`, { field: "rating", operator: "inc", value: -1 * previousValue });
	// delete the vote
	await deleteDocument(_getReqPath(req));
	res.send();
}

