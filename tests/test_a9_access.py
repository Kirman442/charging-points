import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from shapely.geometry import Point
from pyproj import Transformer
UNPROJECT = Transformer.from_crs(32632, 4326, always_xy=True)
import a9_access as access


def fixture():
    coords={1:(11,50.001),2:(11,50),3:(11.002,50),4:(11.002,50.001),10:(11.001,49.999),21:(11.01,50.001),22:(11.01,50),23:(11.012,50),24:(11.012,50.001)}
    nodes=[{'type':'node','id':n,'lon':xy[0],'lat':xy[1]} for n,xy in coords.items()]
    ways=[{'type':'way','id':100,'nodes':[1,2,3,4],'tags':{'highway':'motorway','oneway':'yes'}},
          {'type':'way','id':101,'nodes':[21,22,23,24],'tags':{'highway':'motorway','oneway':'yes'}},
          {'type':'way','id':200,'nodes':[2,10],'tags':{'highway':'motorway_link','oneway':'yes'}},
          {'type':'way','id':201,'nodes':[10,3],'tags':{'highway':'motorway_link','oneway':'yes'}}]
    return nodes+ways


def context(data,route_nodes=[1,2,3,4]):
    network=access.Network(data)
    objects={(o['type'],o['id']):o for o in data}
    route={'nodes':route_nodes,'chain':[0,100,200,300]}
    c=network.search(route,objects,[100,101])
    p=Point(access.PROJECT.transform(11.001,49.999))
    return network,c,p


class AccessTest(unittest.TestCase):
    def test_arrival_and_return_are_direction_specific(self):
        n,c,p=context(fixture());m=n.match(p,c)
        self.assertIsNotNone(m);self.assertEqual(m['exit_node'],2);self.assertEqual(m['entry_node'],3)
        n,c,p=context(fixture(),[21,22,23,24]);self.assertIsNone(n.match(p,c))

    def test_reversed_oneway_cannot_supply_return(self):
        data=fixture();data[-1]['tags']['oneway']='-1'
        n,c,p=context(data);self.assertIsNone(n.match(p,c))

    def test_private_access_does_not_count(self):
        data=fixture();data[-1]['tags']['access']='private'
        n,c,p=context(data);self.assertIsNone(n.match(p,c))

    def test_barrier_without_vehicle_permission_is_excluded(self):
        data=fixture();node=next(o for o in data if o['type']=='node' and o['id']==10);node['tags']={'barrier':'gate'}
        n,c,p=context(data);self.assertIsNone(n.match(p,c))
        node['tags']['motor_vehicle']='yes';n,c,p=context(data);self.assertIsNotNone(n.match(p,c))

    def test_forbidden_turn_is_applied_to_both_searches(self):
        data=fixture();data.append({'type':'relation','id':900,'tags':{'type':'restriction','restriction':'no_straight_on'},'members':[{'type':'way','ref':200,'role':'from'},{'type':'node','ref':10,'role':'via'},{'type':'way','ref':201,'role':'to'}]})
        n,c,p=context(data);self.assertIsNone(n.match(p,c));self.assertEqual(n.restriction_counts['simple_node'],1)

    def test_complex_restriction_is_unknown_not_ignored(self):
        data=fixture();data.append({'type':'relation','id':900,'tags':{'type':'restriction','restriction':'no_left_turn'},'members':[{'type':'way','ref':200,'role':'from'},{'type':'way','ref':201,'role':'via'},{'type':'way','ref':201,'role':'to'}]})
        n,c,p=context(data);self.assertIsNone(n.match(p,c));self.assertEqual(n.restriction_counts['conservatively_excluded_complex'],1)

    def test_nearer_private_road_cannot_be_replaced_with_accessible_public_road(self):
        data=fixture();p=Point(access.PROJECT.transform(11.001,49.999));p=Point(p.x+30,p.y-30)
        xy1=UNPROJECT.transform(p.x-2,p.y);xy2=UNPROJECT.transform(p.x+2,p.y)
        data.extend([{'type':'node','id':31,'lon':xy1[0],'lat':xy1[1]},{'type':'node','id':32,'lon':xy2[0],'lat':xy2[1]},
                     {'type':'way','id':301,'nodes':[31,32],'tags':{'highway':'service','access':'private'}}])
        n,c,_=context(data);self.assertIsNone(n.match(p,c))

    def test_snap_does_not_accept_a_distant_road(self):
        n,c,p=context(fixture());self.assertIsNone(n.match(Point(p.x+500,p.y+500),c))


if __name__=='__main__':unittest.main()
