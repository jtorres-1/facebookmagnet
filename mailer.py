import csv
import json
import os
import time
import smtplib
import imaplib
import email
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from dotenv import load_dotenv
import anthropic

load_dotenv("email.env")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(BASE_DIR)

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465
IMAP_HOST = "imap.gmail.com"
EMAIL_ADDRESS = os.getenv("EMAIL_ADDRESS")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")
ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY")

STATE_FILE = os.path.join(BASE_DIR, "state.json")
LEADS_FILE = os.path.join(BASE_DIR, "leads_with_email.csv")

SUBJECT_STEP1 = "tool that pulls 100 local business leads in 60 seconds"
SUBJECT_FOLLOWUP = "Re: tool that pulls 100 local business leads in 60 seconds"

STEP1 = """Hi {name},

Found your business while looking up {vertical}s in {city}.

Built a tool called MapZap that pulls 100 local business leads as a CSV in about 60 seconds. You type a business type and city, it returns names, phone numbers, addresses, and websites.

$49 one time, no subscription. Thought it might be useful for client prospecting or outreach lists.

mapzap.org if you want to check it out.

Jesse"""

STEP2 = """Hey {name},

Just following up in case this got buried.

MapZap pulls 100 local business leads as a CSV in 60 seconds. Names, phones, addresses. $49 one time, no monthly fee.

If you ever need a quick list for a client campaign or outreach push, mapzap.org

Jesse"""

STEP3 = """Last one from me {name}.

If you do any kind of local outreach or client prospecting, MapZap saves hours of manual list building. 100 leads, any niche, any city, 60 seconds, $49 flat.

mapzap.org

Jesse"""

def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {}

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

def get_smtp_connection(retries=3):
    for attempt in range(retries):
        try:
            server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=30)
            server.login(EMAIL_ADDRESS, EMAIL_PASSWORD)
            return server
        except Exception as e:
            print(f"SMTP connect attempt {attempt+1} failed: {e}")
            time.sleep(10)
    return None

def send_email(server, to, subject, body):
    try:
        msg = MIMEMultipart()
        msg["From"] = EMAIL_ADDRESS
        msg["To"] = to
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain"))
        server.send_message(msg)
        return True
    except smtplib.SMTPServerDisconnected:
        return None  # Signal to reconnect
    except Exception as e:
        print(f"Send error: {e}")
        return False

def get_ai_reply(thread_history, business_name, vertical=""):
    client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)
    vertical_line = f"They are a {vertical}." if vertical else ""
    prompt = f"""You are Jesse, a 21-year-old developer who built MapZap, a tool that pulls 100 local business leads as a CSV in 60 seconds. $49 one time at mapzap.org.

A business owner or marketer replied to your cold email. Your goal is to answer their question and move them toward buying at mapzap.org.

Be short, direct, conversational. Max 3 sentences. No corporate language. If they ask about price it's $49 one time. If they ask how it works: type a business type and city, get 100 leads with names, phones, addresses as a CSV instantly.

Business: {business_name}
{vertical_line}

Thread:
{thread_history}

Write only the reply body, no subject line."""

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=300,
        messages=[{"role": "user", "content": prompt}]
    )
    return response.content[0].text

def check_replies(state):
    try:
        mail = imaplib.IMAP4_SSL(IMAP_HOST)
        mail.login(EMAIL_ADDRESS, EMAIL_PASSWORD)
        mail.select("inbox")
        _, data = mail.search(None, "UNSEEN")
        for num in data[0].split():
            _, msg_data = mail.fetch(num, "(RFC822)")
            msg = email.message_from_bytes(msg_data[0][1])
            sender = email.utils.parseaddr(msg["From"])[1].lower()
            body = ""
            if msg.is_multipart():
                for part in msg.walk():
                    if part.get_content_type() == "text/plain":
                        try:
                            body = part.get_payload(decode=True).decode(errors="ignore")
                        except:
                            body = ""
                        break
            else:
                try:
                    body = msg.get_payload(decode=True).decode(errors="ignore")
                except:
                    body = ""

            if sender in state:
                print(f"Reply from {sender}, generating AI response...")
                thread = state[sender].get("thread", "") + f"\nThem: {body}"
                vertical = state[sender].get("vertical", "")
                ai_reply = get_ai_reply(thread, state[sender].get("name", ""), vertical)
                # Use fresh connection for replies
                reply_server = get_smtp_connection()
                if reply_server:
                    send_email(reply_server, sender, SUBJECT_FOLLOWUP, ai_reply)
                    reply_server.quit()
                state[sender]["thread"] = thread + f"\nYou: {ai_reply}"
                state[sender]["step"] = "replied"
                save_state(state)
        mail.logout()
    except Exception as e:
        print(f"IMAP error: {e}")

def run():
    state = load_state()
    now = datetime.now()

    if not os.path.exists(LEADS_FILE):
        print("No leads_with_email.csv found. Run email_finder first.")
        return

    leads = []
    with open(LEADS_FILE) as f:
        for row in csv.DictReader(f):
            if row.get("Email") and "@" in row["Email"]:
                leads.append(row)

    print(f"Loaded {len(leads)} leads with emails")

    # Open one persistent SMTP connection for the whole batch
    server = get_smtp_connection()
    if not server:
        print("Could not connect to SMTP. Will retry next cycle.")
        return

    sent_count = 0

    for lead in leads:
        email_addr = lead["Email"].lower()
        name = lead.get("Name", "there")
        city = lead.get("City", "your city")
        vertical = lead.get("Vertical", "")

        if email_addr not in state:
            state[email_addr] = {
                "step": 0,
                "name": name,
                "city": city,
                "vertical": vertical,
                "thread": "",
                "last_sent": ""
            }

        entry = state[email_addr]

        if entry["step"] == "replied" or entry["step"] == 3:
            continue

        last_sent = datetime.fromisoformat(entry["last_sent"]) if entry["last_sent"] else None
        step = entry["step"]
        body = None
        subject = None

        if step == 0:
            body = STEP1.format(name=name, city=city, vertical=vertical or "business")
            subject = SUBJECT_STEP1
        elif step == 1 and last_sent and now - last_sent > timedelta(days=2):
            body = STEP2.format(name=name, city=city)
            subject = SUBJECT_FOLLOWUP
        elif step == 2 and last_sent and now - last_sent > timedelta(days=2):
            body = STEP3.format(name=name, city=city)
            subject = SUBJECT_FOLLOWUP

        if not body:
            continue

        result = send_email(server, email_addr, subject, body)

        if result is None:
            # Connection dropped — reconnect and retry
            print("SMTP disconnected — reconnecting...")
            try:
                server.quit()
            except:
                pass
            time.sleep(15)
            server = get_smtp_connection()
            if not server:
                print("Could not reconnect. Stopping batch.")
                break
            result = send_email(server, email_addr, subject, body)

        if result:
            entry["step"] = step + 1
            entry["last_sent"] = now.isoformat()
            entry["thread"] = entry.get("thread", "") + f"\nYou: {body}"
            print(f"Step {step+1} sent → {email_addr}")
            save_state(state)
            sent_count += 1
            # Reconnect every 50 emails to keep connection fresh
            if sent_count % 50 == 0:
                try:
                    server.quit()
                except:
                    pass
                time.sleep(10)
                server = get_smtp_connection()
                if not server:
                    print("Could not reconnect after batch. Stopping.")
                    break
            time.sleep(60)  # 60 second delay between emails
        else:
            print(f"Failed to send to {email_addr}")

    try:
        server.quit()
    except:
        pass

    check_replies(state)
    print(f"Cycle complete. Sent {sent_count} emails.")

if __name__ == "__main__":
    while True:
        run()
        print("Sleeping 1 hour...")
        time.sleep(3600)
