import base64
import hashlib
import hmac
import ipaddress
import json
import os
import re
import time
import unicodedata
import uuid
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

TABLE_NAME = os.environ["TABLE_NAME"]
RATE_LIMIT_SALT = os.environ["RATE_LIMIT_SALT"].encode("utf-8")
RATE_LIMIT_MAX = 3
RATE_LIMIT_WINDOW_SECONDS = 600
MAX_BODY_BYTES = 2048
MAX_NAME_LENGTH = 50
MAX_MESSAGE_LENGTH = 400
PUBLIC_WISH_LIMIT = 50

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)


def response(status_code, payload, extra_headers=None):
    headers = {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, max-age=0",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
    }
    if extra_headers:
        headers.update(extra_headers)
    return {
        "statusCode": status_code,
        "headers": headers,
        "body": json.dumps(payload, ensure_ascii=False),
        "isBase64Encoded": False,
    }


def request_ip(event):
    headers = {key.lower(): value for key, value in (event.get("headers") or {}).items()}
    forwarded = headers.get("cloudfront-viewer-address", "").strip()
    if not forwarded:
        return None

    # CloudFront sends IPv4:port or [IPv6]:port.
    if forwarded.startswith("[") and "]" in forwarded:
        address = forwarded[1:forwarded.index("]")]
    elif forwarded.count(":") == 1:
        address = forwarded.rsplit(":", 1)[0]
    else:
        address = forwarded

    try:
        return str(ipaddress.ip_address(address))
    except ValueError:
        return None


def apply_rate_limit(client_ip):
    now = int(time.time())
    window_start = (now // RATE_LIMIT_WINDOW_SECONDS) * RATE_LIMIT_WINDOW_SECONDS
    window_end = window_start + RATE_LIMIT_WINDOW_SECONDS
    digest = hmac.new(RATE_LIMIT_SALT, client_ip.encode("utf-8"), hashlib.sha256).hexdigest()

    try:
        table.update_item(
            Key={
                "pk": f"RATE#{digest}",
                "sk": f"WINDOW#{window_start}",
            },
            UpdateExpression="SET expires_at = if_not_exists(expires_at, :expires) ADD request_count :one",
            ConditionExpression="attribute_not_exists(request_count) OR request_count < :limit",
            ExpressionAttributeValues={
                ":expires": window_end + 3600,
                ":one": 1,
                ":limit": RATE_LIMIT_MAX,
            },
        )
        return True
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code", "")
        if code == "ConditionalCheckFailedException":
            return False
        raise


def clean_text(value):
    if not isinstance(value, str):
        return ""
    value = unicodedata.normalize("NFKC", value).strip()
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value)


def parse_body(event):
    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        try:
            raw = base64.b64decode(body, validate=True)
        except (ValueError, TypeError):
            return None, "invalid"
    else:
        raw = body.encode("utf-8") if isinstance(body, str) else b""

    if len(raw) > MAX_BODY_BYTES:
        return None, "too_large"

    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None, "invalid"

    if not isinstance(payload, dict):
        return None, "invalid"
    if set(payload) - {"name", "message", "website"}:
        return None, "invalid"

    name = clean_text(payload.get("name"))
    message = clean_text(payload.get("message"))
    website = clean_text(payload.get("website", ""))

    if not name or len(name) > MAX_NAME_LENGTH:
        return None, "invalid"
    if not message or len(message) > MAX_MESSAGE_LENGTH:
        return None, "invalid"

    return {"name": name, "message": message, "website": website}, None


def submit_wish(event):
    headers = {key.lower(): value for key, value in (event.get("headers") or {}).items()}
    if not headers.get("content-type", "").lower().startswith("application/json"):
        return response(415, {"error": "Content-Type must be application/json."})

    payload, error = parse_body(event)
    if error == "too_large":
        return response(413, {"error": "The request is too large."})
    if error:
        return response(400, {"error": "Enter a name and a message within the allowed limits."})

    # Honeypot: respond as if accepted, but do not write bot submissions.
    if payload["website"]:
        return response(202, {"message": "Thank you. Your wish has been received for review."})

    client_ip = request_ip(event)
    if not client_ip:
        return response(403, {"error": "The request could not be verified."})

    try:
        if not apply_rate_limit(client_ip):
            return response(
                429,
                {"error": "Please wait a few minutes before sending another wish."},
                {"retry-after": str(RATE_LIMIT_WINDOW_SECONDS)},
            )

        wish_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        table.put_item(
            Item={
                "pk": f"WISH#{wish_id}",
                "sk": "METADATA",
                "wishId": wish_id,
                "name": payload["name"],
                "message": payload["message"],
                "status": "PENDING",
                "createdAt": created_at,
                "gsi1pk": "STATUS#PENDING",
                "gsi1sk": f"{created_at}#{wish_id}",
            },
            ConditionExpression="attribute_not_exists(pk)",
        )
    except ClientError:
        return response(503, {"error": "We could not save your wish right now. Please try again later."})

    return response(201, {"message": "Thank you. Your wish has been received for review."})


def list_wishes():
    try:
        result = table.query(
            IndexName="status-created_at-index",
            KeyConditionExpression=Key("gsi1pk").eq("STATUS#APPROVED"),
            ScanIndexForward=False,
            Limit=PUBLIC_WISH_LIMIT,
            ProjectionExpression="wishId, #n, message, createdAt",
            ExpressionAttributeNames={"#n": "name"},
        )
    except ClientError:
        return response(503, {"error": "Wishes are temporarily unavailable."})

    wishes = [
        {
            "wishId": item["wishId"],
            "name": item["name"],
            "message": item["message"],
            "createdAt": item["createdAt"],
        }
        for item in result.get("Items", [])
    ]
    return response(200, {"wishes": wishes})


def lambda_handler(event, context):
    path = event.get("rawPath", "")
    method = (event.get("requestContext", {}).get("http", {}).get("method") or "").upper()

    if path != "/api/wishes":
        return response(404, {"error": "Not found."})
    if method == "GET":
        return list_wishes()
    if method == "POST":
        return submit_wish(event)
    return response(405, {"error": "Method not allowed."}, {"allow": "GET, POST"})
