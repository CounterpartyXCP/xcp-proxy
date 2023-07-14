FROM node:fermium-alpine

RUN mkdir -p /app/static

WORKDIR /app
COPY ./package.json /app/
COPY ./package-lock.json /app/
RUN npm install

COPY ./static/ /app/static/
COPY ./index.js /app/

# set up default SSL certs to be self-signed (can be replaced later)
RUN mkdir /root/xcp-proxy-default
RUN mkdir /root/xcp-proxy-default/ssl
RUN cp -a /etc/ssl/certs/ssl-cert-snakeoil.pem /root/xcp-proxy-default/ssl/xcp_proxy.pem
RUN cp -a /etc/ssl/private/ssl-cert-snakeoil.key /root/xcp-proxy-default/ssl/xcp_proxy.key

CMD npm start
