FROM node:fermium-alpine

RUN mkdir /app
WORKDIR /app
COPY ./package.json /app/
COPY ./package-lock.json /app/
RUN npm install

COPY ./static/ /app/
COPY ./index.js /app/

CMD npm start
