# No build step: the page is what is in this directory. nginx serves it, and
# the image is the deploy unit so a rollback is `docker run` on an older tag.
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html config.js styles.css /usr/share/nginx/html/
COPY js/ /usr/share/nginx/html/js/

EXPOSE 8016
