import { Vote } from "sonddr-shared";
import { patchDocument, watchCollection } from "../database.js";


export function watchVotes() {
	watchCollection<Vote>("votes").subscribe(async change => {
		// upon change, update the rating of its comment
		if (change.type === "insert") {
			const vote = change.docAfter;
			_incrementRating(vote.commentId, vote.value);
		} else if (change.type === "delete") {
			const vote = change.docBefore;
			_incrementRating(vote.commentId, -1 * vote.value);
		} else if (change.type === "update") {
			const voteBefore = change.docBefore;
			const voteAfter = change.docAfter;
			const valueDiff = voteAfter.value - voteBefore.value;
			_incrementRating(voteAfter.commentId, valueDiff);
		}
	});
}


// private
// --------------------------------------------
async function _incrementRating(commentId: string, value: number) {
	patchDocument(`comments/${commentId}`, { field: "rating", operator: "inc", value: value });
}
