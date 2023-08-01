export type Doc = {
    id: string,
    [key: string]: any,
};

export class NotFoundError extends Error { }