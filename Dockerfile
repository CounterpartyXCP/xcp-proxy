FROM node:fermium-alpine

RUN mkdir -p /app/static

WORKDIR /app
COPY ./package.json /app/
COPY ./package-lock.json /app/
RUN npm install

COPY ./static/ /app/static/
COPY ./index.js /app/

CMD npm start
