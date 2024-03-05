import { Subject, filter, switchMap } from "rxjs";

import { Change, DbDiscussion, Discussion, Notification, Message, DbMessage, DbComment, DbIdea, Cheer, Idea, DbUser, } from "sonddr-shared";
import { deleteDocuments, getDocument, postDocument, watchCollection } from "./database.js";
import { reviveMessage, reviveDiscussion, reviveUser, reviveChange } from "./revivers.js";
import { deleteUpload } from "./uploads.js";


// notifications
// --------------------------------------------
// change stream
export const notificationsChanges$: Subject<Change<Notification>> = new Subject();
watchCollection<Notification>("notifications").subscribe(notificationsChanges$);


// discussions
// --------------------------------------------
// change stream
export const discussionsChanges$: Subject<Change<Discussion>> = new Subject();
watchCollection<DbDiscussion>("discussions").pipe(
	switchMap(async change => await reviveChange(change, reviveDiscussion))
).subscribe(discussionsChanges$);


// messages
// --------------------------------------------
// change stream
export const messagesChanges$: Subject<Change<Message>> = new Subject();
watchCollection<DbMessage>("messages").pipe(
	switchMap(async change => await reviveChange(change, reviveMessage))
).subscribe(messagesChanges$);


// comments
// --------------------------------------------
// when a comment is deleted, delete its associated votes
watchCollection<DbComment>("comments").pipe(
	filter(change => change.type === "delete")
).subscribe(async (change) => {
	const commentId = change.docId;
	deleteDocuments(`votes`, { field: "commentId", operator: "eq", value: commentId });
});


// ideas
// --------------------------------------------
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

// cheers
// --------------------------------------------
// when a cheer inserted, notify the idea author
// (except if they cheer for their own idea)
watchCollection<Cheer>("cheers").pipe(
	filter(change => change.type === "insert")
).subscribe(async change => {
	const cheer = change.docAfter;
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
});

// comments
// --------------------------------------------
// when a comment is inserted, notify the idea author
// (except if they commented on their own idea)
watchCollection<DbComment>("comments").pipe(
	filter(change => change.type === "insert")
).subscribe(async change => {
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
});
