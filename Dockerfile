FROM node:fermium-alpine

RUN apk add openssl

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
WORKDIR /root/xcp-proxy-default/ssl

RUN openssl req -new -newkey rsa:4096 -nodes -keyout xcp_proxy.key -out xcp_proxy.csr \
        -subj "/C=US/O=OrgName/OU=Unit/CN=Name"
RUN openssl x509 -req -sha256 -days 365 -in xcp_proxy.csr -signkey xcp_proxy.key -out xcp_proxy.pem

RUN cp -a /etc/ssl/certs/ssl-cert-snakeoil.pem /root/xcp-proxy-default/ssl/xcp_proxy.pem
RUN cp -a /etc/ssl/private/ssl-cert-snakeoil.key /root/xcp-proxy-default/ssl/xcp_proxy.key

WORKDIR /app

CMD npm start
