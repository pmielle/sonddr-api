export class NotFoundError extends Error { }

export type Order = {
    field: string,
    desc: boolean,
};

export type Filter = {
    field: string,
    operator: "in"|"eq"|"nin"|"regex",
    value: any,
};

export type Patch = {
    field: string,
    operator: "set"|"inc"|"addToSet"|"pull",
    value: any,
};
