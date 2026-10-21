#!/usr/bin/env python3
"""Send one gravindex database dump as an email attachment.

Called by `/usr/local/bin/gravindex-backup` after the dump has been written and
validated. Standard library only — the host has python3 and no MTA, and a local
MTA is exactly what this avoids: the domain's mail lives at a provider, the VPS
has a generic PTR, and mail sent directly from it would fail SPF alignment. The
message goes out through the provider's authenticated SMTP relay instead, which
is its own signed path.

    gravindex-send-backup /var/backups/gravindex/gravindex-20261021T013000Z.sql.gz
    gravindex-send-backup <file> --dry-run    # build the message, send nothing

Configuration comes from the environment (`/etc/gravindex/mail.env`, 0600,
loaded by `gravindex-backup.service`):

    SMTP_HOST       the relay (the mailbox provider's SMTP server)
    SMTP_PORT       465
    SMTP_SECURITY   ssl | starttls | none
    SMTP_USER       the mailbox
    SMTP_PASSWORD   its password
    MAIL_FROM       what the message says it is from (usually the mailbox)
    MAIL_TO         where the copy goes — no default, and never in this repository

⚠️ The password is never printed, and neither is the message body.
"""

import os
import smtplib
import ssl
import sys
from email.message import EmailMessage
from pathlib import Path


def fail(message: str) -> None:
    print(f"send-backup: {message}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    args = [arg for arg in sys.argv[1:] if arg != "--dry-run"]
    dry_run = "--dry-run" in sys.argv[1:]

    if len(args) != 1:
        fail("usage: gravindex-send-backup <file.sql.gz> [--dry-run]")

    path = Path(args[0])
    if not path.is_file():
        fail(f"{path} is not a file")

    host = os.environ.get("SMTP_HOST", "").strip()
    port = int(os.environ.get("SMTP_PORT", "465"))
    security = os.environ.get("SMTP_SECURITY", "ssl").strip().lower()
    user = os.environ.get("SMTP_USER", "").strip()
    password = os.environ.get("SMTP_PASSWORD", "")
    sender = os.environ.get("MAIL_FROM", "").strip() or user
    recipient = os.environ.get("MAIL_TO", "").strip()

    if not host:
        fail("SMTP_HOST is not set")
    if not sender or not recipient:
        fail("MAIL_FROM and MAIL_TO are both required")

    size = path.stat().st_size

    message = EmailMessage()
    message["Subject"] = f"[gravindex] copia de la base de datos {path.name}"
    message["From"] = sender
    message["To"] = recipient
    message.set_content(
        "Copia de la base de datos de gravindex.\n"
        "\n"
        f"Fichero: {path.name}\n"
        f"Tamaño: {size} bytes\n"
        "\n"
        "Restaurar en una base vacía (⚠️ borra lo que haya en esa base):\n"
        "\n"
        "    gunzip -c <fichero> | docker compose -f docker-compose.prod.yml \\\n"
        "      --env-file .env exec -T gravindex-db \\\n"
        "      psql -U gravindex -d gravindex -v ON_ERROR_STOP=1\n"
    )
    message.add_attachment(
        path.read_bytes(),
        maintype="application",
        subtype="gzip",
        filename=path.name,
    )

    if dry_run:
        print(f"send-backup: dry run, {size} bytes ready for {recipient} via {host}:{port} ({security})")
        return

    context = ssl.create_default_context()
    try:
        if security == "ssl":
            server = smtplib.SMTP_SSL(host, port, timeout=30, context=context)
        elif security == "starttls":
            server = smtplib.SMTP(host, port, timeout=30)
            server.starttls(context=context)
        elif security == "none":
            server = smtplib.SMTP(host, port, timeout=30)
        else:
            fail(f"SMTP_SECURITY must be ssl, starttls or none, not {security!r}")
    except OSError as error:
        fail(f"could not reach {host}:{port}: {error}")

    try:
        if user:
            server.login(user, password)
        server.send_message(message)
    except (OSError, smtplib.SMTPException) as error:
        fail(f"the relay refused the message: {error}")
    finally:
        try:
            server.quit()
        except Exception:  # noqa: BLE001 - a failed QUIT must not hide the send
            pass

    print(f"send-backup: sent {path.name} ({size} bytes) to {recipient}")


if __name__ == "__main__":
    main()
