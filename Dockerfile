FROM node:20

WORKDIR /srv/sonddr

COPY package.json .
RUN npm install

COPY . .

RUN (cd sonddr-shared && npm run build)

EXPOSE 3000

CMD ["npm","start"]
