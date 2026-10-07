import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from shapely.geometry import Point
from a5_exit_zones import elements_for_direction,approach,exits
from road_access_motorcar import Network,PROJECT
from test_a5_motorcar import fixture,context

class ExitZoneTests(unittest.TestCase):
    def test_other_motorways_keep_directions_and_access(self):
        elements=[{'type':'way','id':1,'nodes':[1,2],'tags':{'highway':'motorway','oneway':'yes','ref':'A 5'}},
                  {'type':'way','id':2,'nodes':[3,4],'tags':{'highway':'motorway','oneway':'-1','access':'private','ref':'A 661'}}]
        result=elements_for_direction(elements,{'way_ids':[1]})
        self.assertEqual(result[0]['tags']['highway'],'motorway')
        self.assertEqual(result[1]['tags'],{'highway':'trunk','oneway':'-1','access':'private','ref':'A 661'})
        self.assertEqual(elements[1]['tags']['highway'],'motorway')

    def test_diagnostic_access_never_changes_permission_graph(self):
        data=fixture();data[-1]['tags']['access']='private'
        strict=elements_for_direction(data,{'way_ids':[100,101]})
        optimistic=elements_for_direction(data,{'way_ids':[100,101]},True)
        self.assertEqual(strict[-1]['tags']['access'],'private')
        self.assertNotIn('access',optimistic[-1]['tags'])
        n,c,p=context(strict);self.assertIsNone(n.match(p,c))
        n,c,p=context(optimistic);self.assertIsNotNone(n.match(p,c))

    def test_approach_does_not_require_or_imply_return(self):
        data=fixture();data[-1]['tags']['oneway']='-1'
        n,c,p=context(data)
        self.assertIsNone(n.match(p,c))
        self.assertIsNotNone(approach(n,p,c))

    def test_every_permitted_branch_is_kept_without_junction_tag(self):
        data=fixture();network,ctx,p=context(data)
        objects={('way',o['id']):o for o in data if o['type']=='way'}
        raw={o['id']:o for o in data if o['type']=='way'}
        route={'direction':'north','nodes':[1,2,3,4],'chain':[0,100,200,300],'way_ids':[100,101]}
        found=exits(network,route,objects,{},raw)
        self.assertTrue(any(e['node']==2 for e in found))
        self.assertFalse(found[0]['motorway_junction_tag'])

    def test_rest_area_is_kept_and_emergency_branch_is_not_promoted(self):
        data=fixture();road=next(o for o in data if o.get('id')==200 and o['type']=='way')
        road['tags'].update(highway='motorway_link',destination='Rastplatz Test',**{'destination:symbol':'rest_area;toilets'})
        n,c,p=context(data);objects={('way',o['id']):o for o in data if o['type']=='way'};raw={o['id']:o for o in data if o['type']=='way'}
        route={'direction':'north','nodes':[1,2,3,4],'chain':[0,100,200,300],'way_ids':[100,101]}
        found=exits(n,route,objects,{},raw)
        self.assertTrue(any(e['kind']=='rest_area' for e in found))
        road['tags'].update(access='no',emergency='yes')
        n,c,p=context(data)
        self.assertFalse(any(e['node']==2 for e in exits(n,route,objects,{},raw)))

if __name__=='__main__':unittest.main()
