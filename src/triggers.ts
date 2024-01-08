import { Change, DbDiscussion, Discussion, Notification, Message, DbMessage, DbComment, DbIdea, User, Cheer } from "sonddr-shared";
import { getDocument, postDocument, watchCollection } from "./database.js";
import { Subject, filter, switchMap } from "rxjs";
import { reviveMessage, reviveDiscussion } from "./revivers.js";

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
        let revivedPayload: Discussion|undefined;
        if (change.payload) {
            revivedPayload = await reviveDiscussion(change.payload);
        } else {
            revivedPayload = undefined;
        }
        return {...change, payload: revivedPayload};
    })
).subscribe(discussionsChanges$);

export const messagesChanges$: Subject<Change<Message>> = new Subject(); 
watchCollection<DbMessage>("messages").pipe(
    switchMap(async change => {
        let revivedPayload: Message|undefined;
        if (change.payload) {
            revivedPayload = await reviveMessage(change.payload);
        } else {
            revivedPayload = undefined;
        }
        return {...change, payload: revivedPayload};
    })
).subscribe(messagesChanges$);
