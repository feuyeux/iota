const std = @import("std");
const random_size = @import("random_size.zig");

pub fn main() !void {
    std.debug.print("{s}\n", .{random_size.randomSize()});
}
