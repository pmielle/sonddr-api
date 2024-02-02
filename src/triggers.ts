import { Change, DbDiscussion, Discussion, Notification, Message, DbMessage, DbComment, DbIdea, User, Cheer, Idea } from "sonddr-shared";
import { deleteDocument, deleteDocuments, getDocument, getDocuments, postDocument, watchCollection } from "./database.js";
import { Subject, filter, switchMap } from "rxjs";
import { reviveMessage, reviveDiscussion } from "./revivers.js";
import { deleteUpload } from "./uploads.js";

watchCollection<Idea>("ideas").pipe(
	filter(change => change.type === "delete")
).subscribe(async (change) => {
	const ideaId = change.docId;
	// delete its images
	const idea = change.payload;
	if (idea.cover) { deleteUpload(idea.cover); }
	for (const path of idea.content.matchAll(/<img src="(?<path>\w+)">/g)) {
		deleteUpload(path.groups["path"]);
	}
	// find the comments of this idea
	// and remove their votes
	const comments = await getDocuments<DbComment>(
		`comments`,
		{field: "date", desc: true },
		{ field: "ideaId", operator: "eq", value: ideaId },
	);
	const commentIds = comments.map(c => c.id);
	Promise.all([
		deleteDocuments(`comments`, {field: "ideaId", operator: "eq", value: ideaId}),
		deleteDocuments(`votes`, {field: "commentId", operator: "in", value: commentIds}),
	]);
});

watchCollection<Cheer>("cheers").pipe(
	filter(change => change.type === "insert")
).subscribe(async change => {
	const cheer = change.payload;
	const [commentAuthor, idea] = await Promise.all([
		getDocument<User>(`users/${cheer.authorId}`),
		getDocument<DbIdea>(`ideas/${cheer.ideaId}`),
	]);
	if (commentAuthor.id === idea.authorId) { return; }  // do not notify
	const notificationPayload = {
		toIds: [idea.authorId],
		date: new Date(),
		readByIds: [],
		content: `${commentAuthor.name} cheers for ${idea.title}`,
	};
	postDocument(`notifications`, notificationPayload);
});

watchCollection<DbComment>("comments").pipe(
	filter(change => change.type === "insert")
).subscribe(async change => {
	const dbComment = change.payload;
	const [commentAuthor, idea] = await Promise.all([
		getDocument<User>(`users/${dbComment.authorId}`),
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

export const notificationsChanges$: Subject<Change<Notification>> = new Subject();
watchCollection<Notification>("notifications").subscribe(notificationsChanges$);

export const discussionsChanges$: Subject<Change<Discussion>> = new Subject(); 
watchCollection<DbDiscussion>("discussions").pipe(
    switchMap(async change => {
        let revivedPayload = await reviveDiscussion(change.payload);
        return {...change, payload: revivedPayload};
    })
).subscribe(discussionsChanges$);

export const messagesChanges$: Subject<Change<Message>> = new Subject(); 
watchCollection<DbMessage>("messages").pipe(
    switchMap(async change => {
        let revivedPayload = await reviveMessage(change.payload);
        return {...change, payload: revivedPayload};
    })
).subscribe(messagesChanges$);
