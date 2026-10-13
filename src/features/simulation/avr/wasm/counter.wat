(module
  (global $cycles (mut i32) (i32.const 0))
  (func (export "step") (param $n i32)
    (global.set $cycles (i32.add (global.get $cycles) (local.get $n))))
  (func (export "get_cycles") (result i32) (global.get $cycles)))
