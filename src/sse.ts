import { Response } from "express";

export class SSE {
    
    res: Response;

    constructor(res: Response) {
        this.res = res;
        this.writeHeaders();
    }

    private writeHeaders() {
        this.res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
        });
    }

    public send(payload: any) {
        const message = JSON.stringify(payload);
        this.res.write(`event: message\ndata: ${message}\n\n`);
    }

}