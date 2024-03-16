import { Cheer, DbIdea, DbUser } from "sonddr-shared";
import { getDocument, patchDocument, postDocument, watchCollection } from "../database.js";
import { reviveUser } from "../revivers.js";


export function watchCheers() {
	watchCollection<Cheer>("cheers").subscribe(async change => {
		if (change.type === "insert") {
			// upon insert:
			// - notify the idea author
			// - increment the idea supports
			const cheer = change.docAfter;
			_notifyAuthor(cheer);
			_incrementSupports(cheer.ideaId, 1);
		} else if (change.type === "delete") {
			// upon delete:
			// - decrement the idea supports
			const cheer = change.docBefore;
			_incrementSupports(cheer.ideaId, -1);
		}
	});
}


// private
// --------------------------------------------
async function _notifyAuthor(cheer: Cheer) {
	const [cheerAuthor, idea] = await Promise.all([
		getDocument<DbUser>(`users/${cheer.authorId}`).then(dbDocs => reviveUser(dbDocs, undefined)),
		getDocument<DbIdea>(`ideas/${cheer.ideaId}`),
	]);
	if (cheerAuthor.id === idea.authorId) { return; }  // do not notify
	const notificationPayload = {
		toIds: [idea.authorId],
		date: new Date(),
		readByIds: [],
		content: `${cheerAuthor.name} cheers for ${idea.title}`,
	};
	postDocument(`notifications`, notificationPayload);
}

async function _incrementSupports(ideaId: string, value: 1 | -1) {
	patchDocument(`ideas/${ideaId}`, { field: "supports", operator: "inc", value: value });
}
