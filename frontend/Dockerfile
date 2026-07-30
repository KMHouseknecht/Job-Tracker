FROM nginx:stable-alpine
WORKDIR /usr/share/nginx/html
RUN rm -rf ./*
COPY ../index.html ./
COPY ../styles.css ./
COPY ../app.js ./
COPY ../browser-extension ./browser-extension
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
