import { DbComment, DbIdea, DbUser, } from "sonddr-shared";
import { deleteDocuments, getDocument, postDocument, watchCollection } from "./../database.js";
import { reviveUser } from "./../revivers.js";

export function watchComments() {
	// - upon deletion : delete its associated votes
	// - upon insertion: notify the idea author (except if they commented on their own idea)
	watchCollection<DbComment>("comments").subscribe(async (change) => {
		if (change.type === "delete") {
			const commentId = change.docId;
			deleteDocuments(`votes`, { field: "commentId", operator: "eq", value: commentId });
		} else if (change.type === "insert") {
			const dbComment = change.docAfter;
			const [commentAuthor, idea] = await Promise.all([
				getDocument<DbUser>(`users/${dbComment.authorId}`).then(dbDoc => reviveUser(dbDoc, undefined)),
					getDocument<DbIdea>(`ideas/${dbComment.ideaId}`),
			]);
			if (commentAuthor.id === idea.authorId) { return; }  // do not notify
			const notificationPayload = {
				toIds: [idea.authorId],
				date: new Date(),
				readByIds: [],
				content: `${commentAuthor.name} has commented on ${idea.title}: "${dbComment.content}"`,
			};
			postDocument(`notifications`, notificationPayload);
		}
	});
}

