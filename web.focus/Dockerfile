# No build step: the page is what is in this directory. nginx serves it, and
# the image is the deploy unit so a rollback is `docker run` on an older tag.
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
# Everything index.html asks for by name. manifest.json belongs here and not
# in .dockerignore's company: `try_files … /index.html` means a file left out
# does not 404, it answers with the page as text/html, so a missing manifest
# looks like a working one until iOS quietly refuses to install it.
COPY index.html config.js styles.css manifest.json /usr/share/nginx/html/
COPY icon-180.png icon-192.png icon-512.png /usr/share/nginx/html/
COPY js/ /usr/share/nginx/html/js/

EXPOSE 8016
