import { filter, } from "rxjs";

import { Idea } from "sonddr-shared";
import { deleteDocuments, watchCollection } from "./../database.js";
import { deleteUpload } from "./../uploads.js";


export function watchIdeas() {
	// when an idea is deleted, delete:
	// - its images; cover and content imgs
	// - its comments
	watchCollection<Idea>("ideas").pipe(
		filter(change => change.type === "delete")
	).subscribe(async (change) => {
		const ideaId = change.docId;
		// delete its images
		const idea = change.docBefore;
		if (idea.cover) { deleteUpload(idea.cover); }
		for (const path of idea.content.matchAll(/<img src="(?<path>\w+)">/g)) {
			deleteUpload(path.groups["path"]);
		}
		// delete its comments
		deleteDocuments(`comments`, { field: "ideaId", operator: "eq", value: ideaId });
	});
}
