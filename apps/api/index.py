"""
Vercel serverless entrypoint.
Mangum adapts the FastAPI ASGI app for AWS Lambda / Vercel serverless functions.
"""

from mangum import Mangum
from app.main import app

handler = Mangum(app, lifespan="off")
