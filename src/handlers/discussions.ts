import { Request, Response, NextFunction } from "express";
import { filter as rxFilter } from "rxjs";

import { Change, DbDiscussion, Discussion, User, ping_str } from "sonddr-shared";
import { getDocument, getDocuments, patchDocument, postDocument } from "../database";
import { _getFromReqBody, _getReqPath, _getUnique } from "../handlers";
import { reviveDiscussion, reviveDiscussions } from "../revivers";
import { discussionsChanges$ } from "../triggers";
import { Filter } from "../types";
import { SSE } from "../sse";


export async function getDiscussions(req: Request, res: Response, next: NextFunction) {
	const userId = req["userId"];
	const filter: Filter = { field: "userIds", operator: "in", value: [userId] };
	const sse = new SSE(res);
	const docs = await getDocuments<DbDiscussion>(
		_getReqPath(req),
		{ field: "date", desc: true },
		{ ...filter },  // otherwise can't be reused in watch()
	).then(dbDocs => reviveDiscussions(dbDocs));
	sse.send(docs);
	const changesSub = discussionsChanges$.pipe(
		rxFilter(change => _getUsersOfDiscussionChange(change).map(u => u.id).includes(userId)),
	).subscribe(change => sse.send(change));
	// heartbeat to keep the connection alive
	// otherwise nginx timeouts after 60s
	const pingId = setInterval(() => sse.send(ping_str), 30000);
	req.on("close", () => {
		clearInterval(pingId);
		changesSub.unsubscribe()
	});
}

export async function postDiscussion(req: Request, res: Response, next: NextFunction) {
	const fromUserId = req["userId"];
	const toUserId = _getFromReqBody("toUserId", req);
	const firstMessageContent = _getFromReqBody("firstMessageContent", req);
	const discussionPayload = {
		userIds: [fromUserId, toUserId],
		readByIds: [],
	};
	const discussionId = await postDocument(_getReqPath(req), discussionPayload);
	const firstMessagePayload = {
		discussionId: discussionId,
		authorId: fromUserId,
		content: firstMessageContent,
		date: new Date(),
		deleted: false,
	};
	const firstMessageId = await postDocument('messages', firstMessagePayload);
	await patchDocument(
		`discussions/${discussionId}`,
		[
			{ field: "lastMessageId", operator: "set", value: firstMessageId },
			{ field: "readByIds", operator: "set", value: [fromUserId] },
			{ field: "date", operator: "set", value: firstMessagePayload.date },
		]
	);
	res.json({ insertedId: discussionId });
}

export async function patchDiscussion(req: Request, res: Response, next: NextFunction) {
	await patchDocument(
		_getReqPath(req),
		{ field: 'readByIds', operator: 'addToSet', value: req["userId"] }
	);
	res.send();
}

export async function getDiscussion(req: Request, res: Response, next: NextFunction) {
	const doc = await getDocument<DbDiscussion>(_getReqPath(req))
		.then(dbDoc => reviveDiscussion(dbDoc));
	res.json(doc);
}


// private
// --------------------------------------------
function _getUsersOfDiscussionChange(change: Change<Discussion>): User[] {
	const users = change.docBefore?.users || change.docAfter?.users;
	if (!users) { throw new Error("Failed to find users of change"); }
	return users;
}

