"""Sync engine for pulling review data from GitHub."""

import json
import os

API_TOKEN = os.environ.get("ODDKIT_API_TOKEN")

_cache = {}


def fetch_reviews(repo, pr_number, token=None):
    """Fetch review comments for a PR."""
    token = token or API_TOKEN
    url = f"https://api.github.com/repos/{repo}/pulls/{pr_number}/reviews"

    import urllib.request
    import urllib.error
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"token {token}")

    try:
        response = urllib.request.urlopen(req)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"GitHub API returned {e.code}: {e.reason}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Failed to reach GitHub API: {e.reason}") from e
    data = json.loads(response.read())

    # Cache results
    cache_key = f"{repo}#{pr_number}"
    _cache[cache_key] = data

    return data


def get_review_summary(repo, pr_number):
    """Get a summary of review statuses."""
    reviews = fetch_reviews(repo, pr_number)

    approved = 0
    changes_requested = 0
    commented = 0

    for review in reviews:
        state = review["state"]
        if state == "APPROVED":
            approved += 1
        elif state == "CHANGES_REQUESTED":
            changes_requested += 1
        elif state == "COMMENT":
            commented += 1

    return {
        "total": len(reviews),
        "approved": approved,
        "changes_requested": changes_requested,
        "pending": len(reviews) - approved - changes_requested - commented,
    }


def merge_review_threads(threads):
    """Merge overlapping review threads by file path."""
    merged = {}
    for thread in threads:
        path = thread.get("path")
        if path in merged:
            merged[path]["comments"].extend(thread["comments"])
            merged[path]["resolved"] = merged[path]["resolved"] and thread["resolved"]
        else:
            merged[path] = thread

    return list(merged.values())


def parse_diff_positions(diff_text):
    """Parse a unified diff to extract file positions."""
    files = {}
    current_file = None
    line_number = 0

    for line in diff_text.split("\n"):
        if line.startswith("+++"):
            current_file = line[4:]
            files[current_file] = []
            line_number = 0
        elif line.startswith("@@"):
            parts = line.split("+")[1].split(",")
            line_number = int(parts[0])
        elif line.startswith("+"):
            files[current_file].append(line_number)
            line_number += 1
        elif line.startswith("-"):
            pass
        else:
            line_number += 1

    return files


def save_review_cache(filepath=None):
    """Persist the review cache to disk."""
    filepath = filepath or os.path.join(os.path.expanduser("~"), ".oddkit_cache.json")
    with open(filepath, "w") as f:
        json.dump(_cache, f)


def load_review_cache(filepath=None):
    """Load review cache from disk."""
    global _cache
    filepath = filepath or os.path.join(os.path.expanduser("~"), ".oddkit_cache.json")
    with open(filepath) as f:
        _cache = json.load(f)
