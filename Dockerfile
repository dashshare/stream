FROM node:18

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY index*.js ./
RUN mkdir -p /app/data && chmod -R 777 /app/data
EXPOSE 7860

CMD ["node", "index.js"]
