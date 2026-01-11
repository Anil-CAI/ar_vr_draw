#!/usr/bin/env python3

import asyncio
import json
import ssl

import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist

import websockets

WS_PORT = 8765


class VRBridge(Node):
    def __init__(self):
        super().__init__("vr_teleop_bridge")
        self.pub = self.create_publisher(Twist, "turtle1/cmd_vel", 10)
        self.get_logger().info("VR Teleop Bridge started")


async def ws_handler(websocket, node):
    node.get_logger().info("✅ WebSocket CLIENT CONNECTED")

    try:
        async for msg in websocket:
            node.get_logger().info(f"📨 WS MESSAGE: {msg}")

            data = json.loads(msg)
            if data.get("type") != "cmd_vel":
                continue

            twist = Twist()
            twist.linear.x = float(data.get("linear", 0.0))
            twist.angular.z = float(data.get("angular", 0.0))

            node.pub.publish(twist)
            node.get_logger().info("➡️ Published /cmd_vel")

    except Exception as e:
        node.get_logger().error(str(e))

    node.get_logger().info("❌ WebSocket CLIENT DISCONNECTED")


async def main_async():
    rclpy.init()
    node = VRBridge()

    ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ssl_ctx.load_cert_chain("cert.pem", "key.pem")

    server = await websockets.serve(
        lambda ws: ws_handler(ws, node),
        "0.0.0.0",
        WS_PORT,
        ssl=ssl_ctx,
    )

    node.get_logger().info(f"🌐 WebSocket server running on wss://0.0.0.0:{WS_PORT}")

    try:
        while rclpy.ok():
            rclpy.spin_once(node, timeout_sec=0.1)
            await asyncio.sleep(0.01)
    finally:
        server.close()
        await server.wait_closed()
        rclpy.shutdown()


if __name__ == "__main__":
    asyncio.run(main_async())
