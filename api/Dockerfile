FROM node

WORKDIR /usr/local/src/sonddr-api

COPY package*.json .

RUN npm install --production

COPY src src

EXPOSE 3000

CMD [ "npm", "start" ]

