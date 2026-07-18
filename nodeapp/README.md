# Node app

The node app packages the production frontend in a small, non-root Nginx
container. It does not contain coordinator-specific routes or a general HTTP
proxy. Coordinator requests originate in the browser and use the federation
addresses selected by the frontend.

Build from the repository root:

```bash
npm run build:nodeapp
```

Run locally:

```bash
docker compose -f nodeapp/compose.yml up --build
```

The application listens on `http://127.0.0.1:12596`. The compose file binds
only to loopback; place a separately configured reverse proxy or Tor hidden
service in front of it when remote access is required.

When this container is opened in Tor Browser or through an onion service, the
frontend selects coordinator onion endpoints. On an ordinary browser it uses
the coordinators' clearnet endpoints. The container itself does not make trade
requests on the user's behalf.
