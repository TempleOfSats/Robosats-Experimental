# Privacy notice

RoboSats Experimental is a client for peer-to-peer Bitcoin trading. It does
not include application telemetry, advertising analytics, or automatic crash
reporting.

The application makes network requests that are necessary for features the
user chooses to use:

- coordinator APIs and coordinator Nostr relays provide public offers,
  coordinator information, robot state, order state, encrypted trade chat,
  and notifications;
- user-configured notification integrations, such as Telegram, communicate
  with the service selected by the user;
- links opened by the user may connect to the destination shown by the
  application.

Desktop and mobile packages use their embedded Tor client for coordinator
traffic. The web application relies on the browser and network environment in
which it is opened.

Robot tokens, Fleet keys, private-order passwords, payment details, invoices,
and chat content are not used for telemetry. Some of this information must be
sent to the selected coordinator or relay to perform an operation requested by
the user. Encrypted Fleet synchronization is opt-in through Pro Mode.

The project does not currently provide an automatic application updater.
Release downloads are initiated by the user.

